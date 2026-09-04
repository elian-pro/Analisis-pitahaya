import { dbEnabled, dbLoadAll, dbGet, dbUpsert, dbDelete, APP_USERS_TABLE } from '../config/db';

// ─────────────────────────────────────────────────────────────────────────────
// Usuarios externos (rol client). Viven SOLO en Postgres: un hash de contraseña
// no tiene fallback a JSON en disco. Sin DATABASE_URL el login por contraseña
// simplemente no está disponible.
//
// `v` es la versión de sesión: va dentro de la cookie firmada, y el middleware
// la compara contra la base (con caché corta). Subirla revoca todas las cookies
// vivas de ese usuario; desactivarlo hace lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppUser {
  email:      string;   // id de la fila, siempre en minúsculas
  name:       string;
  client_id:  string;
  hash:       string;   // scrypt$N$r$p$salt$hash (auth/password.ts)
  activo:     boolean;
  v:          number;
  created_at: string;
}

export const usersEnabled = (): boolean => dbEnabled;

const norm = (email: string) => email.trim().toLowerCase();

export async function getUser(email: string): Promise<AppUser | undefined> {
  if (!dbEnabled) return undefined;
  return dbGet<AppUser>(APP_USERS_TABLE, norm(email));
}

export async function listUsers(): Promise<AppUser[]> {
  if (!dbEnabled) return [];
  return dbLoadAll<AppUser>(APP_USERS_TABLE);
}

export async function saveUser(user: AppUser): Promise<void> {
  await dbUpsert(APP_USERS_TABLE, norm(user.email), { ...user, email: norm(user.email) });
  cache.delete(norm(user.email));
}

export async function deleteUser(email: string): Promise<void> {
  await dbDelete(APP_USERS_TABLE, norm(email));
  cache.delete(norm(email));
}

export async function anyUserExists(): Promise<boolean> {
  if (!dbEnabled) return false;
  return (await listUsers()).length > 0;
}

// ── Verificación de sesión viva (revocación) ─────────────────────────────────
// La cookie de un cliente dura 2 h, pero desactivarlo o resetear su contraseña
// debe sacarlo antes. Caché de 60 s para que el costo por request sea ~cero.

const CACHE_MS = 60_000;
const cache = new Map<string, { user: AppUser | undefined; at: number }>();

export async function sessionStillValid(email: string, v: number | undefined): Promise<boolean> {
  const key = norm(email);
  const hit = cache.get(key);
  let user: AppUser | undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    user = hit.user;
  } else {
    user = await getUser(key);
    cache.set(key, { user, at: Date.now() });
  }
  return !!user && user.activo && user.v === (v ?? 0);
}
