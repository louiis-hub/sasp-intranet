create extension if not exists pgcrypto;

create table if not exists public.pointeuse_corrections (
  id uuid primary key default gen_random_uuid(),
  semaine_key text not null,
  semaine_label text,
  agent_id text not null,
  agent_matricule text,
  agent_nom text,
  minutes_retires integer not null default 0,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pointeuse_corrections_unique unique (semaine_key, agent_id)
);

alter table public.pointeuse_corrections enable row level security;

drop policy if exists pointeuse_corrections_auth_all on public.pointeuse_corrections;
create policy pointeuse_corrections_auth_all
on public.pointeuse_corrections
for all
to authenticated
using (true)
with check (true);

drop policy if exists pointeuse_corrections_anon_all on public.pointeuse_corrections;
create policy pointeuse_corrections_anon_all
on public.pointeuse_corrections
for all
to anon
using (true)
with check (true);

notify pgrst, 'reload schema';
