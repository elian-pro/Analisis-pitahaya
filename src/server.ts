import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { dbEnabled, ensureSchema } from './config/db';
import { callsDbEnabled } from './calls/db';
import { seedClientsFromFileIfEmpty } from './clients/manager';
import { seedSchedulesFromFileIfEmpty } from './schedules/store';
import { seedTokenLogFromFileIfEmpty } from './tokens/store';
import { initJobs } from './jobs/store';
import healthRouter from './routes/health';
import advisorsRouter from './routes/advisors';
import reportRouter from './routes/report';
import statsRouter from './routes/stats';
import metricsRouter from './routes/metrics';
import clientsRouter from './routes/clients';
import schedulesRouter from './routes/schedules';
import chatRouter from './routes/chat';
import sheetsRouter from './routes/sheets';
import driveRouter from './routes/drive';
import oauthSetupRouter from './routes/oauthSetup';
import callsRouter from './routes/calls';
import zcisRouter from './routes/zcis';
import usersRouter from './routes/users';
import tenantDbRouter from './routes/tenantDb';
import authRouter from './auth/router';
import { requireApiAuth, requirePage, enforcePolicy } from './auth/middleware';
import { authConfig } from './auth/config';
import { anyUserExists } from './auth/users';
import { startScheduler } from './schedules/runner';
import { startCallsSweeper } from './calls/sweeper';

const app = express();

// Behind EasyPanel's reverse proxy: trust X-Forwarded-Proto so secure cookies work.
app.set('trust proxy', 1);

// CORS restringido: sin origen configurado no se emite Allow-Origin '*'.
// La SPA se sirve desde este mismo servicio, así que same-origin basta.
app.use(cors({ origin: process.env.APP_BASE_URL || false }));
app.use(express.json({ limit: '10mb' }));

const staticDir = path.join(__dirname, '..');

// ── Public endpoints (no auth) ────────────────────────────────────────────────
app.use('/api/health', healthRouter);          // Docker healthcheck
app.use('/auth', authRouter);                  // login / logout / config / me
app.get('/login', (_req, res) => res.sendFile(path.join(staticDir, 'login.html')));

// ── Protected API (401 JSON when unauthenticated; no-op when auth disabled) ────
app.use('/api', requireApiAuth);
app.use('/api', enforcePolicy);            // política por rol/tenant (auth/policy.ts)
app.use('/api/advisors', advisorsRouter);
app.use('/api/report', reportRouter);
app.use('/api/stats', statsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/drive', driveRouter);            // selector de carpetas de Drive
app.use('/api/oauth', oauthSetupRouter);       // setup OAuth cuenta central (Sheets/Drive)
app.use('/api/calls', callsRouter);            // monitoreo del pipeline de llamadas
app.use('/api/zcis', zcisRouter);              // oferta del cliente desde el panel ZCIS
app.use('/api/users', usersRouter);            // usuarios externos (admin)
app.use('/api/tenant/db', tenantDbRouter);     // conexion a la base del cliente externo

// ── Protected frontend (redirect to /login when unauthenticated) ──────────────
app.use(requirePage);
app.use(express.static(staticDir, { index: 'index.html' }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

async function bootstrap(): Promise<void> {
  if (dbEnabled) {
    console.log('🗄️  DATABASE_URL detected — using PostgreSQL for clients, schedules, jobs & tokens');
    await ensureSchema();
    // First boot with a database: migrate any data still living in the JSON
    // files into Postgres so existing deployments carry over automatically.
    await seedClientsFromFileIfEmpty();
    await seedSchedulesFromFileIfEmpty();
    await seedTokenLogFromFileIfEmpty();
  } else {
    console.log('📄 No DATABASE_URL — using JSON files (data will NOT survive redeploys)');
  }

  // Sin secreto fijo, cada deploy invalida todas las sesiones (el secreto se
  // regenera por arranque). Tolerable en dev; no en producción con base.
  if (dbEnabled && authConfig.enabled && !(process.env.AUTH_SESSION_SECRET ?? '').trim()) {
    throw new Error('AUTH_SESSION_SECRET es obligatorio cuando hay DATABASE_URL: sin él, cada deploy cierra todas las sesiones.');
  }
  // Con usuarios externos dados de alta, correr sin autenticación sería dejar
  // la data de los tenants abierta a internet. Mejor no arrancar.
  if (!authConfig.enabled && (await anyUserExists())) {
    throw new Error(
      'Hay usuarios externos en la base pero GOOGLE_OAUTH_CLIENT_ID no está definido: ' +
      'la app correría abierta. Configura la autenticación antes de arrancar.',
    );
  }

  // Load existing jobs into the in-memory cache (from Postgres or the JSON file)
  // and flag any interrupted by the restart. Runs in both modes.
  await initJobs();

  app.listen(env.PORT, () => {
    console.log(`✅ Zebra Reports listening on port ${env.PORT}`);
    startScheduler();
    // El barrido arranca siempre que haya base de llamadas. Lo que decide si un
    // origen se procesa es su interruptor de Ajustes, no una variable que nadie
    // ve: sin fila de configuración o con el switch apagado, el tick no lo toca.
    if (callsDbEnabled()) startCallsSweeper();
  });
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
