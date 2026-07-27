import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { getClient } from '../clients/manager';
import { createJob, getJob, updateJob } from '../jobs/store';
import { runJob } from '../jobs/runner';
import { findSidecarFolder, findPreviousPeriodKey, findRadarSidecar, monthLabel, previousMonth, uploadPdf } from '../google/drive';
import { listAdvisors } from '../advisors/store';
import { previousPeriodKeyFromDb } from '../metrics/store';
import { parseRadarMarkdown } from '../ingest/radarMarkdown';
import { parseRadarSidecar } from '../radar/sidecar';
import { processRadarReport } from '../radar/process';
import { resolveRadarPrompt, type RadarPeriodMeta } from '../claude/radar';
import { runRadarForClient } from '../radar/dbFlow';

const router = Router();

const RADAR_MIN_DURATION_DEFAULT = 200;
const RADAR_MAX_CHARS_DEFAULT     = 8000;

// Human-friendly label for a sidecar period key: 'YYYY-MM' → "Junio 2026",
// 'YYYY-MM-DD' → "Semana del 15/06".
function periodKeyLabel(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) return monthLabel(key);
  const [, m, d] = key.split('-');
  return `Semana del ${d}/${m}`;
}

const PostBodySchema = z.object({
  client_id:   z.string().min(1),
  month:       z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  type:        z.enum(['selected', 'general']),
  advisors:    z.array(z.string().min(1)).min(1, 'At least one advisor required'),
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  data => data.period_type !== 'weekly' || (!!data.date_from && !!data.date_to),
  { message: 'date_from and date_to are required when period_type is weekly' },
);

// POST /api/report — enqueue job, return { job_id }
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = PostBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map(i => `${i.path.length ? i.path.join('.') : 'body'}: ${i.message}`)
      .join('; ');
    console.error('[report POST] validation error:', msg, '| body:', JSON.stringify(req.body));
    res.status(400).json({ error: msg });
    return;
  }

  const { client_id, month, type, advisors, period_type, date_from, date_to } = parsed.data;
  const job = createJob(client_id, month, type, advisors, period_type, date_from, date_to);

  runJob(job).catch(err =>
    console.error('[report route] runJob threw outside handler:', (err as Error).message),
  );

  res.status(202).json({ job_id: job.id });
});

// ── POST /api/report/radar — Radar de Objeciones desde la base (cliente + mes) ─
// Flujo manual del botón de la pestaña "Radar". Genera SOLO el Radar (no el
// reporte de desempeño) para un cliente y un mes, lo sube a su carpeta de Drive y
// devuelve también el PDF en base64 para descarga inmediata. Es síncrono (una
// sola llamada a Claude), como el export del dashboard.
const RadarBodySchema = z.object({
  client_id: z.string().min(1),
  month:     z.string().regex(/^\d{4}-\d{2}$/, 'month debe ser YYYY-MM'),
});

router.post('/radar', async (req: Request, res: Response): Promise<void> => {
  const parsed = RadarBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  const { client_id, month } = parsed.data;
  try {
    const client = await getClient(client_id);
    if (!client) { res.status(404).json({ error: `Cliente '${client_id}' no encontrado` }); return; }
    if (!client.radar_folder_id) {
      res.status(400).json({ error: 'El cliente no tiene "Carpeta Drive de Radar" configurada. Agrégala en la pestaña Reportes.' });
      return;
    }
    const result = await runRadarForClient(client, month);
    res.json({
      reportData:    result.reportData,
      driveUrl:      result.driveUrl,
      pdfBase64:     result.pdfBuffer.toString('base64'),
      input_tokens:  result.input_tokens,
      output_tokens: result.output_tokens,
    });
  } catch (e) {
    console.error('[report radar]', (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── POST /api/report/radar-upload — Radar de Objeciones desde un archivo .md ──
// Flujo por archivo (§1.5): recibe un Markdown de llamadas (multipart), lo parsea
// con los mismos filtros que el flujo desde la base, genera el reporte y lo
// entrega según `deliver` (descarga en base64 y/o subida a Drive). Funciona con o
// sin `client_id`.
const radarUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 }, // 2 MB
}).fields([{ name: 'file', maxCount: 1 }, { name: 'prev_sidecar', maxCount: 1 }]);

function decodeUtf8(buf: Buffer): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return null; }
}

// Periodo por defecto (mes en curso) cuando el archivo/form no lo trae.
function currentMonthPeriod(): { period_label: string; date_from: string; date_to: string; period_key: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m + 1)}-01`;
  const to   = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  return { period_label: monthLabel(`${y}-${pad(m + 1)}`), date_from: from, date_to: to, period_key: `${y}-${pad(m + 1)}` };
}

router.post('/radar-upload', (req: Request, res: Response): void => {
  radarUpload(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      res.status(400).json({ error: `No se pudo subir el archivo: ${(uploadErr as Error).message}` });
      return;
    }
    try {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const mdFile = files?.file?.[0];
      if (!mdFile) { res.status(400).json({ error: 'Falta el archivo .md (campo "file").' }); return; }
      if (!/\.md$/i.test(mdFile.originalname)) { res.status(400).json({ error: 'El archivo debe tener extensión .md' }); return; }

      const fileText = decodeUtf8(mdFile.buffer);
      if (fileText === null) { res.status(422).json({ error: 'El archivo no es UTF-8 válido.' }); return; }

      const body = req.body as Record<string, string>;
      const clientId = (body.client_id || '').trim();
      const client   = clientId ? await getClient(clientId) : undefined;

      const minDur = client?.radar_min_duration_seconds    ?? RADAR_MIN_DURATION_DEFAULT;
      const maxCh  = client?.radar_transcripcion_max_chars ?? RADAR_MAX_CHARS_DEFAULT;
      const excluded = client?.excluded_phrases ?? [];

      // Parseo del Markdown (overrides del form ganan sobre el frontmatter).
      let parsed;
      try {
        parsed = parseRadarMarkdown(fileText, {
          client_name:          body.client_name || undefined,
          period_label:         body.period_label || undefined,
          date_from:            body.date_from || undefined,
          date_to:              body.date_to || undefined,
          contexto_negocio:     body.contexto_negocio || undefined,
          min_duration_seconds: minDur,
          max_chars:            maxCh,
          excluded_phrases:     excluded,
        });
      } catch (e) {
        res.status(422).json({ error: (e as Error).message });
        return;
      }
      if (parsed.calls.length === 0) {
        res.status(422).json({ error: `No quedaron llamadas tras el filtro (duración > ${minDur}s / frases excluidas). Revisa el archivo.` });
        return;
      }

      // Sidecar del periodo anterior (opcional) para el comparativo.
      let prevSidecar = null;
      const prevFile = files?.prev_sidecar?.[0];
      if (prevFile) {
        const prevText = decodeUtf8(prevFile.buffer);
        prevSidecar = prevText ? parseRadarSidecar(prevText) : null;
        if (!prevSidecar) parsed.warnings.push('El prev_sidecar no se pudo leer; el reporte sale como línea base.');
      }

      // Periodo: usa lo del archivo/form; si falta, el mes en curso.
      const def = currentMonthPeriod();
      const date_from = parsed.meta.date_from || def.date_from;
      const date_to   = parsed.meta.date_to   || def.date_to;
      const period_label = parsed.meta.period_label || def.period_label;
      const period_key   = /^\d{4}-\d{2}/.test(date_from) ? date_from.slice(0, 7) : def.period_key;

      const meta: RadarPeriodMeta = {
        client_name:    client?.name || parsed.meta.client_name,
        period_label,
        period_key,
        date_from,
        date_to,
        total_calls:    parsed.meta.total_calls,
        analyzed_calls: parsed.meta.analyzed_calls,
        excluded_calls: parsed.meta.excluded_calls,
        source:         'markdown_upload',
      };

      const systemPrompt = resolveRadarPrompt(client?.prompt_radar ?? null, parsed.meta.contexto);
      const result = await processRadarReport(systemPrompt, meta, parsed.calls, prevSidecar);

      // Entrega
      const deliver = (body.deliver || (clientId ? 'both' : 'download')) as 'download' | 'drive' | 'both';
      const wantDrive = deliver === 'drive' || deliver === 'both';
      const wantDownload = deliver === 'download' || deliver === 'both';

      let driveUrl: string | undefined;
      const stagingFolder = (process.env.RADAR_UPLOAD_STAGING_FOLDER_ID || '').trim();
      const targetFolder = client?.radar_folder_id || stagingFolder;
      if (wantDrive) {
        if (targetFolder) {
          driveUrl = await uploadPdf(targetFolder, meta.client_name, period_key, result.pdfBuffer,
            meta.date_from, meta.date_to);
        } else {
          parsed.warnings.push('No hay carpeta de Drive (ni del cliente ni de staging): el PDF solo se entrega como descarga.');
        }
      }

      res.json({
        reportData:   result.reportData,
        warnings:     parsed.warnings,
        driveUrl,
        pdfBase64:     wantDownload || !driveUrl ? result.pdfBuffer.toString('base64') : undefined,
        sidecarBase64: result.sidecarJson ? Buffer.from(result.sidecarJson, 'utf8').toString('base64') : undefined,
        input_tokens:  result.input_tokens,
        output_tokens: result.output_tokens,
      });
    } catch (e) {
      console.error('[radar-upload]', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });
});

// POST /api/report/:jobId/cancel — request cancellation of a running job
router.post('/:jobId/cancel', (req: Request, res: Response): void => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `Job '${req.params.jobId}' not found` });
    return;
  }
  if (job.status !== 'running' && job.status !== 'pending') {
    res.status(409).json({ error: `Job cannot be cancelled (status: ${job.status})` });
    return;
  }
  updateJob(job.id, { status: 'cancelled' });
  console.log(`[report route] Job ${job.id} cancelled by user`);
  res.json({ ok: true });
});

// GET /api/report/previous — does a prior-period report exist to compare against?
// Used by the confirmation modal to surface a "se detectó reporte anterior" hint.
// Registered before '/:jobId' so the literal path isn't captured as a job id.
const PreviousQuerySchema = z.object({
  client_id:   z.string().min(1),
  month:       z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  advisors:    z.union([z.string(), z.array(z.string())]).transform(
    v => (Array.isArray(v) ? v : [v]).filter(Boolean),
  ),
});

router.get('/previous', async (req: Request, res: Response): Promise<void> => {
  const parsed = PreviousQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  const { client_id, month, period_type, date_from, advisors } = parsed.data;
  if (advisors.length === 0) {
    res.json({ has_previous: false });
    return;
  }

  let client: Awaited<ReturnType<typeof getClient>>;
  try {
    client = await getClient(client_id);
  } catch {
    res.status(500).json({ error: 'Failed to load clients configuration' });
    return;
  }
  if (!client) {
    res.status(404).json({ error: `Client '${client_id}' not found` });
    return;
  }

  try {
    // Database first: a single indexed query, no Drive calls needed when it hits.
    let prevKey = await previousPeriodKeyFromDb(client_id, advisors, month, period_type, date_from);

    // Fallback to Drive sidecars when the DB has nothing (e.g. periods generated
    // before report_metrics existed). Read-only: never create a _Sidecars folder
    // from a GET — a missing folder just means "first period".
    if (!prevKey) {
      const sidecarFolderId = client.sidecar_folder_id
        ?? await findSidecarFolder(client.folder_id);
      if (sidecarFolderId) {
        prevKey = await findPreviousPeriodKey(sidecarFolderId, advisors, month, period_type, date_from);
      }
    }

    if (!prevKey) {
      res.json({ has_previous: false });
      return;
    }
    res.json({ has_previous: true, period_key: prevKey, period_label: periodKeyLabel(prevKey) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[report previous]', msg);
    // Treat lookup failure as "unknown" rather than an error — the hint is purely
    // informational and must never block report generation. `reason` is surfaced to
    // the client only to aid debugging from the browser console.
    res.json({ has_previous: false, unknown: true, reason: msg });
  }
});

// GET /api/report/radar-preflight — que sabemos ANTES de disparar el Radar:
// si hay reporte del periodo anterior para comparar, si el cliente tiene carpeta
// de Drive donde dejar el PDF, y cuantos asesores tiene registrados (el Radar
// solo analiza las llamadas de su roster). Puramente informativo para el modal
// de confirmacion: los errores se degradan a "desconocido", nunca a un 500.
router.get('/radar-preflight', async (req: Request, res: Response): Promise<void> => {
  const client_id = String(req.query.client_id ?? '');
  const month     = String(req.query.month ?? '');
  if (!client_id || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'client_id y month (YYYY-MM) son obligatorios' });
    return;
  }

  let client: Awaited<ReturnType<typeof getClient>>;
  try {
    client = await getClient(client_id);
  } catch {
    res.status(500).json({ error: 'Failed to load clients configuration' });
    return;
  }
  if (!client) {
    res.status(404).json({ error: `Client '${client_id}' not found` });
    return;
  }

  const folderId  = client.radar_folder_id || null;
  const folderUrl = folderId ? `https://drive.google.com/drive/folders/${folderId}` : null;

  let advisorCount = 0;
  try {
    advisorCount = (await listAdvisors(client_id, { includeInactive: true })).length;
  } catch (e) {
    console.warn('[radar preflight] roster lookup failed:', (e as Error).message);
  }

  // Sin carpeta no hay donde buscar el sidecar del periodo anterior.
  const prevKey = previousMonth(month);
  let previous: Record<string, unknown> = { has_previous: false };
  if (folderId) {
    try {
      const sidecarFolder = client.radar_sidecar_folder_id || folderId;
      const prevText = await findRadarSidecar(sidecarFolder, prevKey);
      previous = prevText
        ? { has_previous: true, period_key: prevKey, period_label: periodKeyLabel(prevKey) }
        : { has_previous: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[radar preflight]', msg);
      previous = { has_previous: false, unknown: true, reason: msg };
    }
  }

  res.json({
    client_name:   client.name,
    has_folder:    !!folderId,
    folder_url:    folderUrl,
    advisor_count: advisorCount,
    ...previous,
  });
});

// GET /api/report/:jobId — poll job status
router.get('/:jobId', (req: Request, res: Response): void => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `Job '${req.params.jobId}' not found` });
    return;
  }
  res.json(job);
});

export default router;
