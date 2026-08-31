-- ════════════════════════════════════════════════════════════════════
--  AEGIS — droits d'accès dossier par dossier
--  À exécuter dans l'éditeur SQL de Supabase, après liaisons.sql.
--
--  Trois niveaux : « ecriture », « lecture », « refus ».
--  Le Command Staff et le Lead CID gardent l'accès à tout : ce sont eux
--  qui règlent ces droits, se laisser enfermer dehors n'aurait aucune
--  porte de secours.
-- ════════════════════════════════════════════════════════════════════

-- Ce que reçoit quelqu'un qui a accès à AEGIS mais n'est pas nommé sur
-- ce dossier. « refus » en fait un dossier fermé, ouvert au cas par cas.
ALTER TABLE liaisons_tableaux
  ADD COLUMN IF NOT EXISTS acces_defaut TEXT NOT NULL DEFAULT 'ecriture';

ALTER TABLE liaisons_tableaux
  DROP CONSTRAINT IF EXISTS liaisons_tableaux_acces_defaut_valide;
ALTER TABLE liaisons_tableaux
  ADD CONSTRAINT liaisons_tableaux_acces_defaut_valide
  CHECK (acces_defaut IN ('ecriture', 'lecture', 'refus'));

CREATE TABLE IF NOT EXISTS liaisons_droits (
  tableau_id  BIGINT NOT NULL REFERENCES liaisons_tableaux(id) ON DELETE CASCADE,
  discord_id  TEXT   NOT NULL,
  niveau      TEXT   NOT NULL CHECK (niveau IN ('ecriture', 'lecture', 'refus')),
  nom         TEXT,
  ajoute_par  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tableau_id, discord_id)
);

CREATE INDEX IF NOT EXISTS liaisons_droits_par_personne
  ON liaisons_droits (discord_id);

-- Même verrouillage que le reste : illisible depuis le navigateur, seul
-- le Worker y accède avec la clé service.
ALTER TABLE liaisons_droits ENABLE ROW LEVEL SECURITY;
