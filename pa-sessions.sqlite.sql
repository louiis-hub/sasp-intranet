-- Sessions de la Police Academy, en SQLite
--
--   sqlite3 /var/sasp/sasp.db < pa-sessions.sqlite.sql
--
-- Version SQLite de pa-sessions.sql. La syntaxe Postgres n'y passe pas :
-- bigserial, jsonb et timestamptz n'existent pas. Les correspondances :
--
--   bigserial   -> INTEGER PRIMARY KEY   (SQLite l'alimente seul)
--   jsonb       -> TEXT                  (serialise par la couche d'acces)
--   timestamptz -> TEXT en ISO 8601 UTC  (ce que le code compare deja)
--   boolean     -> INTEGER 0 ou 1
--   now()       -> strftime(...)         (le meme format ISO)
--
-- Il n'y a pas de RLS ici, et il n'en faut pas : le fichier n'est lisible
-- que par le serveur. C'est Postgres qui exposait la base au navigateur,
-- pas SQLite.

create table if not exists pa_sessions (
  id            INTEGER PRIMARY KEY,
  -- Le code du lien public. Long et tire au hasard : c'est la seule
  -- chose qui protege le formulaire, puisqu'il doit rester ouvert a des
  -- gens qui n'ont aucun role.
  code          TEXT NOT NULL UNIQUE,
  titre         TEXT NOT NULL,
  description   TEXT,
  date_session  TEXT,
  places        INTEGER,
  -- Les questions posees, dans l'ordre. Chacune :
  --   { "q": "...", "type": "texte|long", "requis": true }
  questions     TEXT NOT NULL DEFAULT '[]',
  ouverte       INTEGER NOT NULL DEFAULT 1,
  cree_par      TEXT,
  cree_par_id   TEXT,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table if not exists pa_candidatures (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES pa_sessions(id) ON DELETE CASCADE,
  -- Le pseudo saisi par le candidat, et l'identifiant Discord retrouve a
  -- partir de lui. Sans identifiant, pas de message prive possible :
  -- l'ecran le signale au moment de la decision.
  pseudo        TEXT NOT NULL,
  discord_id    TEXT,
  reponses      TEXT NOT NULL DEFAULT '{}',
  statut        TEXT NOT NULL DEFAULT 'attente',   -- attente | accepte | refuse
  motif         TEXT,
  decide_par    TEXT,
  decide_le     TEXT,
  dm_ok         INTEGER,
  dm_erreur     TEXT,
  ip            TEXT,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create index if not exists pa_candidatures_session_idx
  on pa_candidatures (session_id, created_at desc);
create index if not exists pa_sessions_code_idx
  on pa_sessions (code);
