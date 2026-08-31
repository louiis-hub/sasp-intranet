-- Organisation des sessions de la Police Academy
--
-- A executer A LA MAIN dans l'editeur SQL de Supabase.
--
-- Un agent de la PA ouvre une session, le site lui rend un lien. Les
-- candidats repondent au formulaire sans avoir de compte ni de role : ce
-- sont des gens de l'exterieur, c'est tout l'interet. La PA relit les
-- reponses, accepte ou refuse, et le bot previent en message prive.

create table if not exists pa_sessions (
  id            bigserial primary key,
  -- Le code du lien public. Il est long et tire au hasard : c'est la
  -- seule chose qui protege le formulaire, puisqu'il doit rester
  -- ouvert a des gens qui n'ont aucun role.
  code          text unique not null,
  titre         text not null,
  description   text,
  date_session  timestamptz,
  places        int,
  -- Les questions posees, dans l'ordre. Chacune :
  --   { "q": "Votre age RP ?", "type": "texte|long|choix", "options": [...], "requis": true }
  questions     jsonb not null default '[]'::jsonb,
  ouverte       boolean not null default true,
  cree_par      text,
  cree_par_id   text,
  created_at    timestamptz default now()
);

create table if not exists pa_candidatures (
  id            bigserial primary key,
  session_id    bigint not null references pa_sessions(id) on delete cascade,
  -- Le pseudo saisi par le candidat, et l'identifiant Discord retrouve
  -- a partir de lui. Sans identifiant, pas de message prive possible :
  -- l'ecran le signale au moment de la decision.
  pseudo        text not null,
  discord_id    text,
  reponses      jsonb not null default '{}'::jsonb,
  statut        text not null default 'attente',   -- attente | accepte | refuse
  motif         text,
  decide_par    text,
  decide_le     timestamptz,
  dm_ok         boolean,
  dm_erreur     text,
  ip            text,
  created_at    timestamptz default now()
);

create index if not exists pa_candidatures_session_idx on pa_candidatures (session_id, created_at desc);
create index if not exists pa_sessions_code_idx        on pa_sessions (code);

-- RLS active SANS AUCUNE POLICY : rien n'est lisible depuis le
-- navigateur, meme avec la cle anon. Le formulaire public passe par le
-- serveur, qui ne rend que le titre et les questions - jamais les
-- candidatures deja deposees.
alter table pa_sessions     enable row level security;
alter table pa_candidatures enable row level security;
