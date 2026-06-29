import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { dbEnabled, ensureSchema } from './config/db';
import { seedClientsFromFileIfEmpty } from './clients/manager';
import { seedSchedulesFromFileIfEmpty } from './schedules/store';
import { seedTokenLogFromFileIfEmpty } from './tokens/store';
import { initJobs } from './jobs/store';
import healthRouter from './routes/health';
import advisorsRouter from './routes/advisors';
import reportRouter from './routes/report';
import statsRouter from './routes/stats';
import clientsRouter from './routes/clients';
import schedulesRouter from './routes/schedules';
import chatRouter from './routes/chat';
import { startScheduler } from './schedules/runner';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/health', healthRouter);
app.use('/api/advisors', advisorsRouter);
app.use('/api/report', reportRouter);
app.use('/api/stats', statsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/chat', chatRouter);

// Static frontend
const staticDir = path.join(__dirname, '..');
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

  // Load existing jobs into the in-memory cache (from Postgres or the JSON file)
  // and flag any interrupted by the restart. Runs in both modes.
  await initJobs();

  app.listen(env.PORT, () => {
    console.log(`✅ Zebra Reports listening on port ${env.PORT}`);
    startScheduler();
  });
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
