create extension if not exists pgcrypto;

create table if not exists public.pointeuse_paiements (
  id uuid primary key default gen_random_uuid(),
  semaine_key text not null,
  semaine_label text,
  agent_id text not null,
  agent_matricule text,
  agent_nom text,
  paye boolean not null default false,
  checked_by text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pointeuse_paiements_unique unique (semaine_key, agent_id)
);

alter table public.pointeuse_paiements enable row level security;

drop policy if exists pointeuse_paiements_auth_all on public.pointeuse_paiements;
create policy pointeuse_paiements_auth_all
on public.pointeuse_paiements
for all
to authenticated
using (true)
with check (true);

drop policy if exists pointeuse_paiements_anon_all on public.pointeuse_paiements;
create policy pointeuse_paiements_anon_all
on public.pointeuse_paiements
for all
to anon
using (true)
with check (true);
