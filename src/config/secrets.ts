import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Cifrado en reposo para la contraseña de la base de cada cliente externo.
// AES-256-GCM de node:crypto: autenticado (alterar el blob rompe el descifrado)
// y sin dependencias. Formato: v1.<iv>.<tag>.<ciphertext> en base64url.
//
// La clave viene de TENANT_DB_SECRET (64 hex = 32 bytes) y se resuelve al USAR,
// no al importar, para que el módulo sea testeable sin entorno completo.
// OJO: perder la clave vuelve irrecuperables las contraseñas guardadas; habría
// que pedirlas de nuevo a cada cliente.
// ─────────────────────────────────────────────────────────────────────────────

function key(): Buffer {
  const raw = (process.env.TENANT_DB_SECRET ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('TENANT_DB_SECRET debe ser 64 caracteres hex (32 bytes). Genera uno: openssl rand -hex 32');
  }
  return Buffer.from(raw, 'hex');
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(blob: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split('.');
  if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Secreto con formato inválido (se esperaba v1.iv.tag.ct).');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}
