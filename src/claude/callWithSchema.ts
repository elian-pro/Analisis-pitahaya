import type { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Una llamada a Claude con tool use, validada contra un esquema, con reintentos
// que SÍ le dicen al modelo qué salió mal.
//
// Antes cada reporte tenía su propio bucle y los tres intentos mandaban
// exactamente el mismo mensaje: el modelo no se enteraba de que su respuesta
// había sido rechazada, así que repetía el mismo error y el job moría. Ahora el
// intento N+1 arrastra la respuesta rechazada y un tool_result con el motivo,
// que es el mecanismo que la API define para esto.
//
// `send` entra por parámetro (no el SDK) para poder probar el reintento sin
// credenciales ni red, igual que ensureClientFolders recibe su `mkdir`.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaudeReply {
  content: Array<Record<string, unknown> & { type: string }>;
  usage:   { input_tokens: number; output_tokens: number };
}

export type SendFn = (messages: unknown[]) => Promise<ClaudeReply>;

export interface CallResult<T> {
  data:          T;
  input_tokens:  number;
  output_tokens: number;
}

export interface CallOptions<S extends z.ZodTypeAny> {
  send:        SendFn;
  schema:      S;
  /** Prefijo de los logs, p. ej. 'claude/general'. */
  tag:         string;
  /** El mensaje del usuario. Opcional: los llamadores lo ponen en el primer turno. */
  userMessage?: string;
  maxRetries?: number;
}

/** Los issues de zod en una línea, legibles para un humano y para el modelo. */
export function describeIssues(err: z.ZodError): string {
  return err.issues.map(i => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ');
}

// El genérico va sobre el esquema y no sobre su salida: así el tipo devuelto es
// exactamente el de safeParse (con sus defaults aplicados), como en el código
// que este helper sustituye.
export async function callWithSchema<S extends z.ZodTypeAny>(
  opts: CallOptions<S>,
): Promise<CallResult<z.infer<S>>> {
  const maxRetries = opts.maxRetries ?? 3;
  const messages: unknown[] = [{ role: 'user', content: opts.userMessage ?? '' }];
  let lastError: Error = new Error('No attempts made');
  let totalInput = 0, totalOutput = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await opts.send(messages);
      totalInput  += res.usage.input_tokens;
      totalOutput += res.usage.output_tokens;

      const toolBlock = res.content.find(b => b.type === 'tool_use') as
        | (Record<string, unknown> & { type: 'tool_use'; id: string; input: unknown })
        | undefined;
      if (!toolBlock) throw new Error('Claude response contained no tool_use block');

      const parsed = opts.schema.safeParse(toolBlock.input);
      if (parsed.success) {
        return { data: parsed.data, input_tokens: totalInput, output_tokens: totalOutput };
      }

      const detalle = describeIssues(parsed.error);
      // El turno que convierte un reintento ciego en una corrección: se devuelve
      // la respuesta rechazada y el motivo, en el formato de tool_result.
      messages.push({ role: 'assistant', content: res.content });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          is_error: true,
          content:
            `La respuesta no pasó la validación: ${detalle}. ` +
            `Corrige ÚNICAMENTE esos campos usando exactamente uno de los valores permitidos ` +
            `por el esquema de la herramienta, y vuelve a llamarla con el resto igual.`,
        }],
      });
      throw new Error(`Zod validation failed (attempt ${attempt}): ${detalle}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        console.warn(`[${opts.tag}] Attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      }
    }
  }
  throw lastError;
}
