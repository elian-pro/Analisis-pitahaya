// ─────────────────────────────────────────────────────────────────────────────
// Cliente HTTP de ZCIS, el panel donde vive la oferta de cada cliente (qué
// vende, qué problema resuelve, mecanismo, diferenciadores, precio). Es la
// segunda vía para llenar `contexto_negocio`: la primera es escribirlo a mano, y
// las dos conviven —solo 1 de los 5 clientes de hoy está en ZCIS—.
//
// La llave entra por parámetro, como en transcribe.ts y analyze.ts: config/env
// hace process.exit(1) al cargarse si falta una variable requerida, así que
// importarla aquí dejaría este módulo sin poder probarse fuera de un entorno
// completo. Quien la resuelve es la ruta.
//
// Y por el mismo motivo por el que la llave no se importa aquí, tampoco viaja al
// navegador: la oferta es material confidencial de cada cliente y esa llave
// abre la de todos. El frontend habla con nuestro backend; este módulo es el
// único que habla con ZCIS.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchLike = typeof globalThis.fetch;

export interface ZcisConfig {
  base: string;
  key:  string;
}

export interface ZcisCliente {
  cliente_id:    string;
  nombre:        string;
  vertical?:     string;
  activo:        boolean;
  /** false = la ficha quedó desactualizada respecto al brief. */
  ficha_vigente: boolean;
  tiene_oferta:  boolean;
}

export interface ZcisOferta {
  cliente_id:     string;
  nombre:         string;
  /** Markdown TAL CUAL lo devuelve ZCIS, con sus notas internas. Ver limpiar.ts. */
  contenido:      string;
  actualizado_en: string;
}

/** Tiempo máximo de espera: sin él, un ZCIS caído deja el formulario colgado. */
const TIMEOUT_MS = 15_000;

async function pedir<T>(cfg: ZcisConfig, ruta: string, fetchFn: FetchLike): Promise<T> {
  const url = `${cfg.base.replace(/\/+$/, '')}${ruta}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError'
      ? `ZCIS no respondió en ${TIMEOUT_MS / 1000} s.`
      : `No se pudo conectar con ZCIS (${(e as Error).message}).`;
    throw new Error(msg);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('ZCIS rechazó la llave (ZCIS_API_KEY). Revisa que sea la vigente.');
  }
  if (res.status === 404) {
    throw new Error('ZCIS no tiene ese cliente, o el cliente no tiene oferta cargada.');
  }
  if (!res.ok) {
    throw new Error(`ZCIS respondió HTTP ${res.status}.`);
  }
  return await res.json() as T;
}

export async function listarClientes(
  cfg:     ZcisConfig,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<ZcisCliente[]> {
  const d = await pedir<{ clientes?: ZcisCliente[] }>(cfg, '/api/v1/clientes', fetchFn);
  return d.clientes ?? [];
}

export async function obtenerOferta(
  cfg:       ZcisConfig,
  clienteId: string,
  fetchFn:   FetchLike = globalThis.fetch,
): Promise<ZcisOferta> {
  const d = await pedir<{
    cliente_id?: string;
    nombre?:     string;
    oferta?:     { contenido?: string; actualizado_en?: string };
  }>(cfg, `/api/v1/clientes/${encodeURIComponent(clienteId)}/oferta`, fetchFn);

  if (!d.oferta?.contenido) {
    throw new Error(`La ficha de ${d.nombre ?? clienteId} en ZCIS no tiene oferta redactada.`);
  }
  return {
    cliente_id:     d.cliente_id ?? clienteId,
    nombre:         d.nombre ?? clienteId,
    contenido:      d.oferta.contenido,
    actualizado_en: d.oferta.actualizado_en ?? '',
  };
}
