-- ══════════════════════════════════════════════════════════════════
--  Attestations de test de résidus de poudre (commande Discord /test)
--  À exécuter une fois dans l'éditeur SQL de Supabase (projet SUD).
--
--  Chaque test effectué par un agent est consigné ici, puis consultable
--  et réimprimable depuis la page « Tests de poudre » de l'intranet.
--
--  Toutes les commandes sont idempotentes.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tests_poudre (
  id                 SERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ DEFAULT NOW(),

  -- Personne testée
  personne_nom       TEXT,
  personne_naissance TEXT,

  -- Circonstances du test
  date_test          TEXT,
  heure_test         TEXT,

  -- Agent ayant effectué le test
  agent_nom          TEXT,
  agent_matricule    TEXT,
  agent_discord_id   TEXT,

  -- Lien vers le message Discord d'origine
  discord_channel_id TEXT,
  discord_message_id TEXT,

  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Colonnes ajoutées après coup : idempotent si la table existait déjà.
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS personne_nom       TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS personne_naissance TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS date_test          TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS heure_test         TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS agent_nom          TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS agent_matricule    TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS agent_discord_id   TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS discord_channel_id TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS discord_message_id TEXT;
ALTER TABLE tests_poudre ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

-- Les plus récents d'abord, c'est l'usage de la page.
CREATE INDEX IF NOT EXISTS tests_poudre_created_at_idx ON tests_poudre (created_at DESC);

-- ── Accès ─────────────────────────────────────────────────────────
-- Même convention que les autres tables du site.
ALTER TABLE tests_poudre ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON tests_poudre;
CREATE POLICY "auth_all" ON tests_poudre FOR ALL TO authenticated USING (true) WITH CHECK (true);
