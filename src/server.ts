import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import healthRouter from './routes/health';
import advisorsRouter from './routes/advisors';
import reportRouter from './routes/report';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/health', healthRouter);
app.use('/api/advisors', advisorsRouter);
app.use('/api/report', reportRouter);

// Static frontend
const staticDir = path.join(__dirname, '..', );
app.use(express.static(staticDir, { index: 'index.html' }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(env.PORT, () => {
  console.log(`✅ Zebra Reports listening on port ${env.PORT}`);
});
