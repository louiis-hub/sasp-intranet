-- ════════════════════════════════════════════════════════════════════
--  Tableau de liaisons — SASP SUD
--  À exécuter dans l'éditeur SQL de Supabase.
--
--  Ces tables ne sont JAMAIS lues depuis le navigateur : aucune police
--  RLS n'ouvre l'accès, seul le Worker Cloudflare (clé service, qui
--  contourne RLS) peut les lire et les écrire. C'est ce qui garantit
--  qu'un visiteur non autorisé ne reçoit aucune donnée d'enquête,
--  même en s'adressant directement à Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ── Un tableau par dossier d'enquête ────────────────────────────────
CREATE TABLE IF NOT EXISTS liaisons_tableaux (
  id          BIGSERIAL PRIMARY KEY,
  nom         TEXT NOT NULL DEFAULT 'Nouveau dossier',
  dossier     TEXT,
  nodes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges       JSONB NOT NULL DEFAULT '[]'::jsonb,
  seq         INTEGER NOT NULL DEFAULT 100,
  -- Incrémenté à chaque écriture : sert de verrou optimiste.
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Journal : horodaté, jamais modifié, jamais supprimé ─────────────
CREATE TABLE IF NOT EXISTS liaisons_journal (
  id          BIGSERIAL PRIMARY KEY,
  tableau_id  BIGINT REFERENCES liaisons_tableaux(id) ON DELETE SET NULL,
  discord_id  TEXT,
  utilisateur TEXT,
  role        TEXT,
  action      TEXT NOT NULL,
  cible       TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS liaisons_journal_tableau_idx
  ON liaisons_journal (tableau_id, created_at DESC);

-- ── Accès nominatifs, ouverts par le Command Staff ──────────────────
-- Pour les personnes qui n'ont pas le rôle Discord (invités, DOJ…).
CREATE TABLE IF NOT EXISTS liaisons_acces (
  discord_id  TEXT PRIMARY KEY,
  nom         TEXT,
  peut_ecrire BOOLEAN NOT NULL DEFAULT true,
  ajoute_par  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Verrouillage : rien n'est lisible depuis le navigateur ──────────
ALTER TABLE liaisons_tableaux ENABLE ROW LEVEL SECURITY;
ALTER TABLE liaisons_journal  ENABLE ROW LEVEL SECURITY;
ALTER TABLE liaisons_acces    ENABLE ROW LEVEL SECURITY;
-- Aucune policy n'est créée : RLS active sans policy = tout est refusé
-- à anon et authenticated. La clé service du Worker n'est pas concernée.

-- ── Premier dossier ─────────────────────────────────────────────────
INSERT INTO liaisons_tableaux (id, nom, dossier)
SELECT 1, 'Tableau principal', 'ENQ-SUD-001'
WHERE NOT EXISTS (SELECT 1 FROM liaisons_tableaux WHERE id = 1);

SELECT setval(
  pg_get_serial_sequence('liaisons_tableaux', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM liaisons_tableaux), 1)
);
