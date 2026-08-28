-- ══════════════════════════════════════════════════════════════════
--  Affaires Internes — témoignages et plaintes visant des agents
--  À exécuter une fois dans l'éditeur SQL de Supabase (projet SUD).
--
--  Distinct de la table `plaintes`, qui recueille les plaintes des
--  civils contre des tiers. Ici le mis en cause est un agent SASP,
--  et le dossier est traité par les Affaires Internes.
--
--  Toutes les commandes sont idempotentes.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plaintes_ai (
  id                   SERIAL PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT NOW(),

  -- Déclarant
  declarant_nom        TEXT,
  declarant_telephone  TEXT,

  -- Faits reprochés
  type_declaration     TEXT DEFAULT 'Plainte',
  agents_concernes     TEXT,
  lieu_faits           TEXT,
  description          TEXT,

  -- Agent ayant enregistré la déclaration
  agent_nom            TEXT,
  agent_discord_id     TEXT,

  -- Suivi par les Affaires Internes
  statut               TEXT DEFAULT 'Nouvelle',
  traite_par           TEXT,
  traite_at            TIMESTAMPTZ,
  notes                TEXT,

  -- Lien vers le message Discord d'origine
  discord_channel_id   TEXT,
  discord_message_id   TEXT,

  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Colonnes ajoutées après coup : sans effet si la table existait déjà.
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS declarant_nom       TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS declarant_telephone TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS type_declaration    TEXT DEFAULT 'Plainte';
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS agents_concernes    TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS lieu_faits          TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS description         TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS agent_nom           TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS agent_discord_id    TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS statut              TEXT DEFAULT 'Nouvelle';
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS traite_par          TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS traite_at           TIMESTAMPTZ;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS discord_channel_id  TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS discord_message_id  TEXT;
ALTER TABLE plaintes_ai ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS plaintes_ai_created_at_idx ON plaintes_ai (created_at DESC);

-- ── Accès ─────────────────────────────────────────────────────────
-- Même convention que les autres tables du site.
ALTER TABLE plaintes_ai ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON plaintes_ai;
CREATE POLICY "auth_all" ON plaintes_ai FOR ALL TO authenticated USING (true) WITH CHECK (true);
