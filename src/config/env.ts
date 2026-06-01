import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  GOOGLE_SA_JSON: z.string().min(1, 'GOOGLE_SA_JSON is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  PORT: z.coerce.number().int().positive().default(3000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Missing required environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export function getGoogleServiceAccount(): object {
  try {
    return JSON.parse(env.GOOGLE_SA_JSON);
  } catch {
    console.error('❌ GOOGLE_SA_JSON is not valid JSON');
    process.exit(1);
  }
}
