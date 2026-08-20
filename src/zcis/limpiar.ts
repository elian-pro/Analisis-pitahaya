// ─────────────────────────────────────────────────────────────────────────────
// La oferta que guarda ZCIS es un documento DE TRABAJO: junto al contenido real
// lleva notas del agente que lo redactó sobre lo que falta por confirmar. Ese
// texto acaba en el contexto de negocio, y de ahí en el prompt de un reporte que
// se le envía al cliente en PDF. Sin limpiarlo, lo previsible es que Claude
// escriba que la oferta del cliente tiene huecos por validar.
//
// Es función pura y sin dependencias a propósito: es la única barrera entre las
// notas internas y un documento que ve el cliente, así que tiene que poder
// probarse contra el markdown real sin red, sin credenciales y sin servidor.
// ─────────────────────────────────────────────────────────────────────────────

/** Sin tildes y en minúsculas: los títulos llegan en ambas cajas ("## PRUEBA"). */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * El agente de ZCIS marca lo no confirmado de dos formas distintas, y hay que
 * distinguirlas o se pierde contenido bueno:
 *
 *   Sofía   `[ASUNCION A VALIDAR] El brief no incluye numeros de ocupacion…`
 *           el párrafo ENTERO es la nota.
 *   Maraya  `773 terrenos en total. […] [ASUNCION A VALIDAR: no define criterio…]`
 *           la nota va entre corchetes, detrás de una frase que sí es la oferta.
 *
 * Borrar el párrafo entero en el segundo caso se llevaría por delante un
 * diferenciador real; borrar solo los corchetes en el primero dejaría la nota
 * suelta y sin su marca, que es peor que dejarla marcada.
 */
const MARCA_AL_INICIO = /^\s*\[\s*asunci[oó]n a validar/i;
const MARCA_EN_LINEA  = /\s*\[\s*ASUNCI[OÓ]N A VALIDAR[^\]]*\]/gi;

/** Títulos de sección que son notas de proceso y no parte de la oferta. */
const SECCIONES_INTERNAS = ['pendientes a validar'];

/**
 * La procedencia del documento se distingue por la cursiva: `*Documento
 * elaborado exclusivamente con informacion del brief…*`, en un párrafo suyo y
 * al cierre. La negrita NO sirve para esto —el documento la usa para los
 * subtítulos de dentro de una sección ("**Densidad controlada**")—, así que la
 * cursiva completa es la marca y el asterisco doble se respeta.
 */
const esNotaDeDocumento = (bloque: string): boolean =>
  /^\*[^*][^\n]*\*$/.test(bloque.trim());

/**
 * En el preámbulo sí hay una línea de procedencia en negrita, bajo el título:
 * `**Agente de Oferta Zebra · Extracción desde Brief Maestro**`. Ahí no hay
 * subtítulos con los que confundirla.
 */
const esProcedenciaDelTitulo = (linea: string): boolean =>
  /^\*{1,2}[^*][^\n]*\*{1,2}$/.test(linea.trim());

/**
 * Coletilla de borrador en el título: `# OFERTA MARAYA · DOCUMENTO DE TRABAJO`.
 * El H1 se conserva porque lleva el nombre comercial del producto ("Sofia
 * Boutique Condos"), que es justo lo que hace que la transcripción escriba bien
 * la marca en vez de inventar una parecida.
 */
const COLETILLA_BORRADOR = /\s*[·|\-–]\s*(documento de trabajo|borrador|draft)\s*$/i;

interface Seccion {
  titulo?: string;
  bloques: string[];
}

function partirEnSecciones(md: string): Seccion[] {
  const bloques = md.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out: Seccion[] = [{ bloques: [] }];
  for (const b of bloques) {
    if (/^-{3,}$/.test(b)) continue;                 // separador: se regenera al final
    if (/^##\s+/.test(b)) out.push({ titulo: b, bloques: [] });
    else out[out.length - 1].bloques.push(b);
  }
  return out;
}

/** Quita del preámbulo las líneas de procedencia y la coletilla del título. */
function limpiarPreambulo(bloque: string): string {
  return bloque
    .split('\n')
    .filter(l => !esProcedenciaDelTitulo(l))
    .map(l => (l.startsWith('#') ? l.replace(COLETILLA_BORRADOR, '') : l))
    .join('\n')
    .trim();
}

/**
 * Devuelve la oferta lista para usarse como contexto de negocio.
 *
 * Techo conocido: solo quita lo que va MARCADO. La prosa de proceso sin marca
 * ("**Nota de uso:** el brief establece…", "segun el brief") sobrevive, porque
 * reconocerla pide criterio y no un patrón. Por eso el campo queda editable
 * después de importar: la última revisión es humana.
 */
export function limpiarOferta(markdown: string): string {
  const usaSeparadores = /^\s*-{3,}\s*$/m.test(markdown);

  const limpias = partirEnSecciones(markdown)
    .filter(s => !(s.titulo && SECCIONES_INTERNAS.includes(norm(s.titulo.replace(/^##\s+/, '')))))
    .map(s => ({
      titulo: s.titulo?.replace(COLETILLA_BORRADOR, ''),
      bloques: s.bloques
        .filter(b => !MARCA_AL_INICIO.test(b))
        .filter(b => !esNotaDeDocumento(b))
        .map(b => (s.titulo ? b : limpiarPreambulo(b)))
        .map(b => b.replace(MARCA_EN_LINEA, '').trim())
        // Un bloque que era solo la nota queda vacío tras quitarle la marca.
        .filter(Boolean),
    }))
    // Una sección que se queda sin contenido desaparece: en Sofía, "## Prueba"
    // es íntegramente una asunción. No se borra por llamarse Prueba —en otro
    // cliente tiene datos reales—, se cae sola por quedarse sin nada dentro.
    .filter(s => s.bloques.length > 0);

  return limpias
    .map(s => (s.titulo ? `${s.titulo}\n\n${s.bloques.join('\n\n')}` : s.bloques.join('\n\n')))
    .join(usaSeparadores ? '\n\n---\n\n' : '\n\n')
    .trim() + '\n';
}
