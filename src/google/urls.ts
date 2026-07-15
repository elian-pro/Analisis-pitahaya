// Extrae el ID de Google desde un link pegado (o lo deja igual si ya es un ID).
// Pensado para que el equipo solo tenga que copiar el link de la hoja / carpeta,
// sin buscar el ID a mano. Se usa en el frontend (UX inmediata) y en el servidor
// (red de seguridad al guardar el cliente).

const ID = '([a-zA-Z0-9-_]+)';

// https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0  →  <ID>
export function extractSpreadsheetId(input: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  const m = s.match(new RegExp(`/spreadsheets/d/${ID}`)) || s.match(new RegExp(`/d/${ID}`));
  if (m) return m[1];
  // Ya parece un ID: quita cualquier resto de query/hash accidental.
  return s.split(/[/?#]/)[0];
}

// https://drive.google.com/drive/folders/<ID>?usp=...  →  <ID>
// También soporta ...open?id=<ID> y links de archivo /d/<ID>.
export function extractDriveFolderId(input: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  const m =
    s.match(new RegExp(`/folders/${ID}`)) ||
    s.match(new RegExp(`[?&]id=${ID}`)) ||
    s.match(new RegExp(`/d/${ID}`));
  if (m) return m[1];
  return s.split(/[/?#]/)[0];
}
