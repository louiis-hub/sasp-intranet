create table if not exists public.service_logements (
  id uuid primary key default uuid_generate_v4(),
  numero integer not null unique,
  gamme text not null check (gamme in ('Haut de gamme','Bas de gamme')),
  loyer integer not null,
  statut text not null default 'Libre' check (statut in ('Libre','Occupé','Maintenance')),
  agent_id uuid references public.agents(id) on delete set null,
  occupant_nom text,
  date_attribution date,
  notes text,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

alter table public.service_logements enable row level security;

drop policy if exists service_logements_auth_all on public.service_logements;
create policy service_logements_auth_all on public.service_logements
  for all to authenticated
  using (true)
  with check (true);

insert into public.service_logements (numero, gamme, loyer)
select n, 'Haut de gamme', 3500
from generate_series(1, 10) n
on conflict (numero) do nothing;

insert into public.service_logements (numero, gamme, loyer)
select n, 'Bas de gamme', 2500
from generate_series(11, 20) n
on conflict (numero) do nothing;
