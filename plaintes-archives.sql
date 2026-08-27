-- ══════════════════════════════════════════════════════════════════
--  Archivage des plaintes déposées via la commande Discord /plainte
--  À exécuter une fois dans l'éditeur SQL de Supabase (projet SUD).
--
--  La table `plaintes` existait déjà mais ne servait qu'à générer un
--  numéro : seule la colonne created_at était renseignée, le contenu
--  vivait uniquement dans l'embed Discord. On y ajoute les champs du
--  formulaire pour pouvoir consulter les plaintes depuis le site.
--
--  Toutes les commandes sont idempotentes : relancer ce fichier ne
--  casse rien et ne duplique aucune colonne.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plaintes (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Contenu du formulaire /plainte ────────────────────────────────
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS plaignant          TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS mis_en_cause       TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS telephone          TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS motif              TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS resume             TEXT;

-- ── Agent ayant enregistré la plainte ─────────────────────────────
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS agent_discord_id   TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS agent_nom          TEXT;

-- ── Suivi côté site ───────────────────────────────────────────────
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS statut             TEXT DEFAULT 'Nouvelle';
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS traite_par         TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS traite_at          TIMESTAMPTZ;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS notes              TEXT;

-- ── Lien vers le message Discord d'origine ────────────────────────
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS discord_channel_id TEXT;
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS discord_message_id TEXT;

-- ── Mise à jour automatique de la date de traitement ──────────────
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

-- Les plus récentes d'abord, c'est l'usage de la page Plaintes.
CREATE INDEX IF NOT EXISTS plaintes_created_at_idx ON plaintes (created_at DESC);

-- ── Accès ─────────────────────────────────────────────────────────
-- Même convention que les autres tables du site : lecture et écriture
-- réservées aux utilisateurs authentifiés via Supabase. Le bot, lui,
-- passe par la clé service et n'est pas soumis à ces règles.
ALTER TABLE plaintes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON plaintes;
CREATE POLICY "auth_all" ON plaintes FOR ALL TO authenticated USING (true) WITH CHECK (true);
