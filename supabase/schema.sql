-- ─────────────────────────────────────────────────────────────────────────────
-- Zebra Reports · Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- Clients: each row holds the full client object in `data` (jsonb), keyed by id.
create table if not exists public.clients (
  id          text primary key,
  data        jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Automations (schedules): same shape.
create table if not exists public.schedules (
  id          text primary key,
  data        jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Enable Row Level Security with NO policies. The backend uses the service_role
-- key, which bypasses RLS, so it keeps full access — while anon/public keys get
-- nothing. This protects the data if a public key is ever exposed.
alter table public.clients   enable row level security;
alter table public.schedules enable row level security;
