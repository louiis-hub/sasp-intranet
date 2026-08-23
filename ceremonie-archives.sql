create extension if not exists pgcrypto;

create table if not exists public.ceremonie_archives (
  id uuid primary key default gen_random_uuid(),
  session_label text,
  archived_by text,
  votes_count integer not null default 0,
  agents_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  votes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ceremonie_archives enable row level security;

drop policy if exists ceremonie_archives_auth_all on public.ceremonie_archives;
create policy ceremonie_archives_auth_all
on public.ceremonie_archives
for all
to authenticated
using (true)
with check (true);

drop policy if exists ceremonie_archives_anon_all on public.ceremonie_archives;
create policy ceremonie_archives_anon_all
on public.ceremonie_archives
for all
to anon
using (true)
with check (true);

notify pgrst, 'reload schema';
