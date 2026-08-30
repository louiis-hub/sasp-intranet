-- ════════════════════════════════════════════════════════════════════
--  AEGIS — schéma des types d'éléments, modifiable depuis le site
--  À exécuter dans l'éditeur SQL de Supabase, après liaisons.sql.
--
--  Une seule ligne, partagée par tout le monde : si le Command Staff
--  ajoute un champ, tout le monde le voit. Tant que la ligne est vide,
--  le site utilise le schéma d'origine livré dans la page.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS liaisons_schema (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  data        JSONB,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  CONSTRAINT liaisons_schema_ligne_unique CHECK (id = 1)
);

-- Même verrouillage que le reste : illisible depuis le navigateur,
-- seul le Worker y accède avec la clé service.
ALTER TABLE liaisons_schema ENABLE ROW LEVEL SECURITY;

INSERT INTO liaisons_schema (id, data)
SELECT 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM liaisons_schema WHERE id = 1);
