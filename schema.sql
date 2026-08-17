-- ══════════════════════════════════════════════════════════════════
--  SASP INTRANET — Schéma Supabase
--  À exécuter dans : Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Utilisateurs de l'app (admin / academy) ───────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nom        TEXT NOT NULL DEFAULT '',
  prenom     TEXT NOT NULL DEFAULT '',
  app_role   TEXT NOT NULL DEFAULT 'agent',  -- 'admin' | 'academy' | 'agent'
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Grades ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grades (
  id         SERIAL PRIMARY KEY,
  nom        TEXT UNIQUE NOT NULL,
  abrev      TEXT,
  ordre      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO grades (nom, abrev, ordre) VALUES
  ('Recruit',          'RCT',   1),
  ('Trooper I',        'TPR I', 2),
  ('Trooper II',       'TPR II',3),
  ('Senior Trooper',   'S.TPR', 4),
  ('Corporal',         'CPL',   5),
  ('Sergeant I',       'SGT I', 6),
  ('Sergeant II',      'SGT II',7),
  ('Lieutenant I',     'LT I',  8),
  ('Lieutenant II',    'LT II', 9),
  ('Captain',          'CPT',  10),
  ('Deputy Commissioner','D.COM',11),
  ('Commissioner',     'COM',  12)
ON CONFLICT (nom) DO NOTHING;

-- ── Unités ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id               SERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  nom              TEXT NOT NULL,
  description      TEXT,
  conditions_acces TEXT,
  discord_role_id  TEXT,
  created_at       TIMESTAMP DEFAULT NOW()
);

INSERT INTO units (code, nom, description) VALUES
  ('PA',   'SASP Academy',               'Formation initiale des nouvelles recrues SASP.'),
  ('CID',  'Criminal Investigation Div.','Investigations criminelles et enquêtes judiciaires.'),
  ('FTF',  'Fugitive Task Force',         'Recherche, convocation et suivi des fugitifs.'),
  ('SWAT', 'Special Weapons and Tactics','Interventions tactiques à haut risque.'),
  ('TU',   'Traffic Unit',               'Contrôle de la circulation et accidents de la route.'),
  ('HP',   'Highway Patrol',             'Patrouille autoroutière et premier engagement.')
ON CONFLICT (code) DO NOTHING;

-- ── Agents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricule        TEXT UNIQUE NOT NULL,
  nom              TEXT NOT NULL,
  prenom           TEXT NOT NULL,
  date_naissance   DATE,
  telephone        TEXT,
  photo_url        TEXT,
  grade            TEXT NOT NULL DEFAULT 'Cadet',
  date_recrutement DATE DEFAULT CURRENT_DATE,
  date_promotion   DATE,
  statut           TEXT NOT NULL DEFAULT 'Actif',  -- Actif | Suspendu | Retraité | Archivé
  -- Formations PPA
  ppa1       BOOLEAN DEFAULT FALSE,
  ppa1_date  DATE,
  ppa2       BOOLEAN DEFAULT FALSE,
  ppa2_date  DATE,
  ppa3       BOOLEAN DEFAULT FALSE,
  ppa3_date  DATE,
  -- Qualifications
  qual_pa   BOOLEAN DEFAULT FALSE,
  qual_cid  BOOLEAN DEFAULT FALSE,
  qual_swat BOOLEAN DEFAULT FALSE,
  qual_tu   BOOLEAN DEFAULT FALSE,
  qual_prd  BOOLEAN DEFAULT FALSE,
  -- Unités (tableau)
  unites    TEXT[] DEFAULT '{}',
  notes     TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Historique des agents ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_historique (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    UUID REFERENCES agents(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- 'promotion' | 'sanction' | 'recompense' | 'note'
  titre       TEXT NOT NULL,
  description TEXT,
  date        DATE DEFAULT CURRENT_DATE,
  auteur_id   UUID REFERENCES agents(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── Dossiers disciplinaires ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS dossiers_disciplinaires (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       UUID REFERENCES agents(id) ON DELETE CASCADE,
  motif          TEXT NOT NULL,
  description    TEXT,
  decision       TEXT,
  date           DATE DEFAULT CURRENT_DATE,
  responsable_id UUID REFERENCES agents(id),
  created_at     TIMESTAMP DEFAULT NOW()
);

-- ── MDT — Catégories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mdt_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom        TEXT NOT NULL,
  emoji      TEXT DEFAULT '📁',
  parent_id  UUID REFERENCES mdt_categories(id) ON DELETE CASCADE,
  ordre      INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── MDT — Pages ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mdt_pages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  categorie_id UUID REFERENCES mdt_categories(id) ON DELETE CASCADE,
  titre        TEXT NOT NULL,
  contenu      TEXT DEFAULT '',
  ordre        INTEGER DEFAULT 0,
  auteur_id    UUID REFERENCES agents(id),
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY  (accès authentifié uniquement)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE app_users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_historique       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dossiers_disciplinaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdt_categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdt_pages              ENABLE ROW LEVEL SECURITY;

-- Politique : tout utilisateur authentifié peut tout lire et écrire
-- (les restrictions de rôle sont gérées côté JS)
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['app_users','agents','agent_historique',
  'dossiers_disciplinaires','grades','units','mdt_categories','mdt_pages'])
LOOP
  EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON %I', t);
  EXECUTE format('CREATE POLICY "auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
END LOOP; END $$;

-- ══════════════════════════════════════════════════════════════════
--  PREMIER ADMIN — à exécuter après vous être inscrit
--  Remplacez l'email par le vôtre
-- ══════════════════════════════════════════════════════════════════
-- INSERT INTO app_users (user_id, nom, prenom, app_role)
-- SELECT id, 'NomAdmin', 'PrenomAdmin', 'admin'
-- FROM auth.users
-- WHERE email = 'votre@email.com'
-- ON CONFLICT DO NOTHING;
