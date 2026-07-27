// Emparejamiento de nombres de asesor entre la hoja y el roster del cliente.
// Vive aparte de dbFlow/store para que no arrastre credenciales de Google ni la
// conexion a la base al importarse (asi es verificable sin entorno configurado).
//
// Dos clientes pueden compartir la misma hoja (mismo negocio, dos productos y dos
// equipos comerciales). El roster es lo unico que los separa, asi que este
// emparejamiento es la frontera entre sus reportes.

export const normalizeAdvisorName = (s: string) => s.trim().toLowerCase();

export function rosterMatcher(rosterNames: string[]): (asesor: string) => boolean {
  const set = new Set(rosterNames.map(normalizeAdvisorName));
  return (asesor: string) => set.has(normalizeAdvisorName(asesor));
}
