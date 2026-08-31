insert into public.grades (nom, abrev, ordre)
values ('Chief', 'CHF', 999)
on conflict (nom) do update
set abrev = excluded.abrev,
    ordre = greatest(public.grades.ordre, excluded.ordre);

alter table public.agents
alter column grade set default 'Rookie';
