create table if not exists public.service_logement_paiements (
  id uuid primary key default uuid_generate_v4(),
  logement_id uuid not null references public.service_logements(id) on delete cascade,
  date_paiement date not null,
  montant integer not null,
  paye boolean not null default true,
  note text,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique(logement_id, date_paiement)
);

alter table public.service_logement_paiements enable row level security;

drop policy if exists service_logement_paiements_auth_all on public.service_logement_paiements;
create policy service_logement_paiements_auth_all on public.service_logement_paiements
  for all to authenticated
  using (true)
  with check (true);
