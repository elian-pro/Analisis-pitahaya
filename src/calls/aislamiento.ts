// ─────────────────────────────────────────────────────────────────────────────
// Qué cuenta de llamadas puede ver quién. Es la única regla de aislamiento de
// la pestaña Llamadas, así que vive sola, sin tocar base ni red, y se prueba.
//
// Se escribió después de un fallo real: desde la vista de un cliente externo se
// listaban las llamadas de Midstorage. Fallaron dos cosas a la vez, y las dos
// están aquí.
// ─────────────────────────────────────────────────────────────────────────────

export interface SesionMinima { role?: 'admin' | 'client'; client_id?: string }

export interface SlugResuelto {
  /** La cuenta a consultar. undefined = ninguna pedida. */
  slug?: string;
  /**
   * Si se permite caer a "la primera cuenta habilitada" cuando no hay slug.
   * Para un tenant es SIEMPRE false: la primera cuenta del sistema es, por
   * definición, la de otro.
   */
  permitirPrimera: boolean;
}

export function resolverSlug(user: SesionMinima | undefined, slugPedido?: string): SlugResuelto {
  if (user?.role === 'client') {
    return { slug: user.client_id, permitirPrimera: false };
  }
  return { slug: slugPedido || undefined, permitirPrimera: !slugPedido };
}

/**
 * Si un slug que NO resolvió como cuenta de tenant puede buscarse en el
 * registro de Callpicker. Para un cliente externo, no: si todavía no conectó su
 * base la respuesta correcta es "no hay cuenta", nunca una cuenta ajena que
 * comparta el slug.
 */
export function puedeCaerAlRegistro(esClienteExterno: boolean): boolean {
  return !esClienteExterno;
}
