-- Pointeuse Discord - les deux tables
--
-- Postgres. Les correspondances SQLite sont a la fin.
--
-- « pointages » porte les prises de service. « pointeuse_corrections »
-- porte les rattrapages accordes par l'encadrement, une ligne par agent
-- et par semaine.

-- ── les prises de service ──────────────────────────────────────────
create table if not exists pointages (
  id                        bigserial primary key,
  -- Le lien vers la fiche agent. La pointeuse retrouve la personne par
  -- son identifiant Discord, jamais par son pseudo : un pseudo change,
  -- un identifiant non.
  agent_id                  bigint not null,
  discord_id                text,

  clock_in                  timestamptz not null default now(),
  clock_out                 timestamptz,

  -- Pourquoi le service s'est termine. Vaut null quand l'agent a
  -- clique lui-meme sur « fin de service ».
  --   AUTO_CLOSED_MINUS_4H   ferme d'office, jamais confirme
  --   AUTO_CLOSED_MINUS_1H   ferme d'office, avait deja confirme
  --   AUTO_CLOSED_WEEKLY     ferme par le cron du dimanche
  clockout_reason           text,

  -- La duree reellement decomptee, penalite comprise. Distincte de
  -- l'ecart entre clock_in et clock_out, qui est la duree brute.
  total_duration_seconds    integer,

  -- ── le mecanisme anti-oubli ──
  -- Quand la prochaine confirmation est due.
  next_confirmation_at      timestamptz,
  -- Quand la demande est partie. Non nul = on attend une reponse, et
  -- le compte a rebours de 15 minutes tourne.
  confirmation_requested_at timestamptz,
  last_confirmation_at      timestamptz,
  confirmation_count        integer not null default 0,
  -- Ou joindre le message prive, pour desactiver ses boutons ensuite.
  confirmation_channel_id   text,
  confirmation_message_id   text
);

-- Le cron des 15 minutes ne lit que les services ouverts : l'index
-- partiel evite de parcourir tout l'historique a chaque passage.
create index if not exists idx_pointages_active_confirmation_due
  on pointages (clock_out, next_confirmation_at, confirmation_requested_at)
  where clock_out is null;

create index if not exists idx_pointages_discord_id on pointages (discord_id);

-- ── les rattrapages accordes ───────────────────────────────────────
create table if not exists pointeuse_corrections (
  id               uuid primary key default gen_random_uuid(),
  -- La semaine visee, pour que la correction s'applique au bon decompte.
  semaine_key      text not null,
  semaine_label    text,
  agent_id         text not null,
  agent_matricule  text,
  agent_nom        text,
  -- Negatif pour crediter des heures, positif pour en retirer.
  minutes_retires  integer not null default 0,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Une seule correction par agent et par semaine : deux lignes se
  -- cumuleraient sans que personne ne le voie.
  constraint pointeuse_corrections_unique unique (semaine_key, agent_id)
);

-- RLS active sans policy : rien n'est lisible depuis le navigateur.
-- Seul le serveur, qui porte la cle service, y accede.
alter table pointages             enable row level security;
alter table pointeuse_corrections enable row level security;

-- ── en SQLite ──────────────────────────────────────────────────────
--   bigserial   -> INTEGER PRIMARY KEY
--   uuid        -> TEXT (poser l'identifiant soi-meme)
--   timestamptz -> TEXT en ISO 8601 UTC
--   now()       -> strftime('%Y-%m-%dT%H:%M:%SZ','now')
--   pas de RLS, et il n'en faut pas : le fichier n'est lisible que par
--   le serveur.
