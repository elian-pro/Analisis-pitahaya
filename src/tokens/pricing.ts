// ─────────────────────────────────────────────────────────────────────────────
// Tarifas por modelo, en USD por millón de tokens. ÚNICO lugar con precios:
// antes vivían duplicados en tokens/store.ts y jobs/runner.ts, y solo cubrían a
// Claude. El costo se calcula AL ESCRIBIR el registro (tokens/store.ts): las
// tarifas cambian y una fila histórica conserva el precio que pagó.
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = 'anthropic' | 'google' | 'openai';

export const PRECIOS: Record<string, { provider: Provider; input: number; output: number }> = {
  'claude-sonnet-4-6': { provider: 'anthropic', input: 3.0,  output: 15.0 },
  'gemini-3.5-flash':  { provider: 'google',    input: 0.30, output: 2.50 },
  'gpt-4o-mini':       { provider: 'openai',    input: 0.15, output: 0.60 },
};

/** Costo en USD. Modelo desconocido → 0 con aviso: la telemetría nunca lanza. */
export function costoUSD(model: string, input: number, output: number): number {
  const p = PRECIOS[model];
  if (!p) {
    console.warn(`[tokens] modelo sin tarifa: '${model}' (costo registrado como 0)`);
    return 0;
  }
  return (input / 1e6) * p.input + (output / 1e6) * p.output;
}

export function providerOf(model: string): Provider | 'desconocido' {
  return PRECIOS[model]?.provider ?? 'desconocido';
}
