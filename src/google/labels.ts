// Cómo se escribe un periodo para que lo lea una persona: en el PDF, en el
// nombre del archivo de Drive y en los avisos de Google Chat. Módulo sin
// dependencias a propósito — vivía en drive.ts, que arrastra credenciales de
// Google y hacía imposible probar esto.

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

// Rango de una semana en texto: "27 jul – 02 ago 2026". El año se escribe una
// sola vez, salvo que la semana cruce de diciembre a enero.
export function weekLabel(dateFrom: string, dateTo: string): string {
  const parse = (d: string) => d.split('-').map(Number);
  const [y1, m1, d1] = parse(dateFrom);
  const [y2, m2, d2] = parse(dateTo);
  const short = (m: number) => MONTHS_ES[m - 1].slice(0, 3).toLowerCase();
  const pad2  = (n: number) => String(n).padStart(2, '0');

  const from = `${pad2(d1)} ${short(m1)}${y1 !== y2 ? ` ${y1}` : ''}`;
  return `${from} – ${pad2(d2)} ${short(m2)} ${y2}`;
}
