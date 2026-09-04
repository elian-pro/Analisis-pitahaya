import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getUser, listUsers, saveUser, deleteUser, usersEnabled, type AppUser } from '../auth/users';
import { hashPassword } from '../auth/password';
import { getClient } from '../clients/manager';

// ─────────────────────────────────────────────────────────────────────────────
// Gestión de usuarios externos (rol client). Admin-only por política.
// La contraseña se devuelve UNA sola vez (al crearla o resetearla); después
// solo existe su hash.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

function requireDb(res: Response): boolean {
  if (usersEnabled()) return true;
  res.status(503).json({ error: 'Los usuarios externos requieren DATABASE_URL.' });
  return false;
}

const publicView = (u: AppUser) => ({
  email: u.email, name: u.name, client_id: u.client_id, activo: u.activo, created_at: u.created_at,
});

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  if (!requireDb(res)) return;
  res.json((await listUsers()).map(publicView));
});

const CreateSchema = z.object({
  email:     z.string().email(),
  name:      z.string().min(1).max(80),
  client_id: z.string().min(1),
  password:  z.string().min(8).optional(), // sin ella se genera una
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  if (!requireDb(res)) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(' · ') });
    return;
  }
  const { email, name, client_id } = parsed.data;
  if (!(await getClient(client_id))) {
    res.status(400).json({ error: `No existe el cliente ${client_id}.` });
    return;
  }
  if (await getUser(email)) {
    res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    return;
  }
  const password = parsed.data.password ?? crypto.randomBytes(9).toString('base64url');
  const user: AppUser = {
    email: email.toLowerCase(), name, client_id,
    hash: hashPassword(password), activo: true, v: 1,
    created_at: new Date().toISOString(),
  };
  await saveUser(user);
  res.status(201).json({ ...publicView(user), password }); // única vez que se ve
});

const PatchSchema = z.object({
  activo:   z.boolean().optional(),
  name:     z.string().min(1).max(80).optional(),
  reset_password: z.boolean().optional(),
});

router.patch('/:email', async (req: Request, res: Response): Promise<void> => {
  if (!requireDb(res)) return;
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos.' });
    return;
  }
  const user = await getUser(req.params.email);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado.' });
    return;
  }
  if (parsed.data.name !== undefined)   user.name = parsed.data.name;
  if (parsed.data.activo !== undefined) user.activo = parsed.data.activo;
  let password: string | undefined;
  if (parsed.data.reset_password) {
    password = crypto.randomBytes(9).toString('base64url');
    user.hash = hashPassword(password);
  }
  // Desactivar o resetear revoca las cookies vivas (v va dentro del token).
  if (parsed.data.reset_password || parsed.data.activo === false) user.v += 1;
  await saveUser(user);
  res.json({ ...publicView(user), ...(password ? { password } : {}) });
});

router.delete('/:email', async (req: Request, res: Response): Promise<void> => {
  if (!requireDb(res)) return;
  if (!(await getUser(req.params.email))) {
    res.status(404).json({ error: 'Usuario no encontrado.' });
    return;
  }
  await deleteUser(req.params.email);
  res.json({ ok: true });
});

export default router;
