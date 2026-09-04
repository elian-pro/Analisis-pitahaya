// ─────────────────────────────────────────────────────────────────────────────
// Política de autorización de la API: la ÚNICA tabla que decide qué puede tocar
// cada rol. El middleware enforcePolicy la aplica a todo /api/*; el test de
// arquitectura (policy.test.ts) garantiza que ninguna ruta exista sin entrada
// aquí, así que agregar un endpoint obliga a decidir su régimen.
//
// Regímenes:
//   'public'  — sin sesión (solo /api/health).
//   'admin'   — solo rol admin (correo del dominio de la agencia).
//   'tenant'  — un cliente externo puede usarla, PERO acotado a su client_id.
//               `own` dice dónde vive ese client_id:
//                 query   → se fuerza req.query.client_id
//                 body    → se fuerza req.body.client_id
//                 param   → el segmento :id debe ser el suyo
//                 job     → el job :jobId debe pertenecerle (404 si no, para
//                           no confirmar la existencia de jobs ajenos)
//                 handler → el handler filtra por req.user (listados y ramas
//                           tenant dentro del propio handler)
// ─────────────────────────────────────────────────────────────────────────────

export type Own = 'query' | 'body' | 'param' | 'job' | 'handler';
export interface PolicyEntry {
  rol: 'public' | 'admin' | 'tenant';
  own?: Own;
}

export const POLITICAS: Record<string, PolicyEntry> = {
  'GET /api/health': { rol: 'public' },

  // ── Reportes: el corazón de la vista del cliente ───────────────────────────
  'POST /api/report':                    { rol: 'tenant', own: 'body' },
  'GET /api/report/previous':            { rol: 'tenant', own: 'query' },
  'GET /api/report/:jobId':              { rol: 'tenant', own: 'job' },
  'POST /api/report/:jobId/cancel':      { rol: 'tenant', own: 'job' },
  'GET /api/report/:jobId/download':     { rol: 'tenant', own: 'job' },
  'POST /api/report/radar':              { rol: 'admin' },
  'POST /api/report/radar-upload':       { rol: 'admin' },
  'GET /api/report/radar-preflight':     { rol: 'admin' },

  // ── Asesores: el roster se lee para generar; se edita solo desde admin ─────
  'GET /api/advisors':                   { rol: 'tenant', own: 'query' },
  'POST /api/advisors':                  { rol: 'admin' },
  'PATCH /api/advisors/:id':             { rol: 'admin' },
  'DELETE /api/advisors/:id':            { rol: 'admin' },

  // ── Clientes: el externo solo puede VERSE a sí mismo ───────────────────────
  'GET /api/clients':                    { rol: 'tenant', own: 'handler' },
  'GET /api/clients/:id':                { rol: 'tenant', own: 'param' },
  'POST /api/clients':                   { rol: 'admin' },
  'PUT /api/clients/:id':                { rol: 'admin' },
  'DELETE /api/clients/:id':             { rol: 'admin' },

  // ── Llamadas: vistas tenant-aware; operación del pipeline solo admin ───────
  'GET /api/calls':                      { rol: 'tenant', own: 'handler' },
  'GET /api/calls/cuentas':              { rol: 'tenant', own: 'handler' },
  'GET /api/calls/:slug/:call_id':       { rol: 'tenant', own: 'handler' },
  'POST /api/calls/reprocess':           { rol: 'admin' },
  'POST /api/calls/:slug/:call_id/process': { rol: 'admin' },
  'GET /api/calls/diagnostico':          { rol: 'admin' },
  'GET /api/calls/esquemas':             { rol: 'admin' },
  'POST /api/calls/activar':             { rol: 'admin' },
  'POST /api/calls/origenes/:esquema/auto':     { rol: 'admin' },
  'GET /api/calls/origenes/:esquema/asesores':  { rol: 'admin' },
  'GET /api/calls/origenes/:esquema/config':    { rol: 'admin' },
  'POST /api/calls/origenes/:esquema/config':   { rol: 'admin' },

  // ── Base del cliente externo ───────────────────────────────────────────────
  'GET /api/tenant/db':                  { rol: 'tenant', own: 'handler' },
  'POST /api/tenant/db/test':            { rol: 'tenant', own: 'handler' },
  'PUT /api/tenant/db':                  { rol: 'admin' },
  'POST /api/tenant/db/provision':       { rol: 'admin' },

  // ── Todo lo demás es infraestructura de la agencia ─────────────────────────
  'GET /api/stats':                      { rol: 'admin' },
  'GET /api/metrics':                    { rol: 'admin' },
  'POST /api/metrics/pdf':               { rol: 'admin' },
  'GET /api/schedules':                  { rol: 'admin' },
  'POST /api/schedules':                 { rol: 'admin' },
  'PUT /api/schedules/:id':              { rol: 'admin' },
  'POST /api/schedules/:id/run':         { rol: 'admin' },
  'DELETE /api/schedules/:id':           { rol: 'admin' },
  'GET /api/chat/spaces':                { rol: 'admin' },
  'GET /api/sheets/tabs':                { rol: 'admin' },
  'GET /api/sheets/headers':             { rol: 'admin' },
  'GET /api/drive/folders':              { rol: 'admin' },
  'GET /api/drive/names':                { rol: 'admin' },
  'GET /api/oauth/google/start':         { rol: 'admin' },
  'GET /api/oauth/google/callback':      { rol: 'admin' },
  'GET /api/zcis/clientes':              { rol: 'admin' },
  'GET /api/zcis/clientes/:id/oferta':   { rol: 'admin' },
  'GET /api/users':                      { rol: 'admin' },
  'POST /api/users':                     { rol: 'admin' },
  'PATCH /api/users/:email':             { rol: 'admin' },
  'DELETE /api/users/:email':            { rol: 'admin' },
};

/**
 * Empareja método+ruta real contra las claves de la tabla. Devuelve la entrada
 * y los parámetros capturados de los segmentos `:x`.
 */
export function matchPolicy(
  method: string,
  path: string,
): { entry: PolicyEntry; params: Record<string, string> } | null {
  const clean = path.replace(/\/+$/, '') || '/';
  const wantSeg = clean.slice(1).split('/');
  // Ante empate (p. ej. /api/report/previous vs /api/report/:jobId) gana el
  // patrón con más segmentos literales, no el orden de la tabla.
  let best: { entry: PolicyEntry; params: Record<string, string>; literals: number } | null = null;
  for (const [key, entry] of Object.entries(POLITICAS)) {
    const [verb, pattern] = key.split(' ');
    if (verb !== method.toUpperCase()) continue;
    const patSeg = pattern.slice(1).split('/');
    if (patSeg.length !== wantSeg.length) continue;
    const params: Record<string, string> = {};
    let ok = true, literals = 0;
    for (let i = 0; i < patSeg.length; i++) {
      if (patSeg[i].startsWith(':')) params[patSeg[i].slice(1)] = decodeURIComponent(wantSeg[i]);
      else if (patSeg[i] !== wantSeg[i]) { ok = false; break; }
      else literals++;
    }
    if (ok && (!best || literals > best.literals)) best = { entry, params, literals };
  }
  return best ? { entry: best.entry, params: best.params } : null;
}
