import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Hash de contraseñas con scrypt de node:crypto. Sin dependencias: la stdlib
// cubre el caso y el formato autodescriptivo permite subir el costo en el
// futuro sin invalidar los hashes viejos.
//
// Formato: scrypt$N$r$p$<salt b64url>$<hash b64url>
// ─────────────────────────────────────────────────────────────────────────────

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    if (!salt.length || !expected.length) return false;
    const got = crypto.scryptSync(password, salt, expected.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(got, expected);
  } catch {
    return false; // formato corrupto o parámetros inválidos: nunca lanzar en el login
  }
}
