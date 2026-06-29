import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client. Uses the SERVICE ROLE key, which bypasses RLS —
// it must NEVER be exposed to the browser. Both values come from environment
// variables only; the service fails fast if either is missing.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase environment variables:');
  if (!SUPABASE_URL)              console.error('  SUPABASE_URL is required');
  if (!SUPABASE_SERVICE_ROLE_KEY) console.error('  SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Table names — single source of truth.
export const CLIENTS_TABLE   = 'clients';
export const SCHEDULES_TABLE = 'schedules';
