-- ════════════════════════════════════════════════════════════════════
--  BUREAU SASP - messagerie, discussions, documents, prises de contact
--  À exécuter dans l'éditeur SQL de Supabase.
--
--  Comme pour AEGIS : RLS activé sans aucune policy. Rien n'est lisible
--  depuis le navigateur, tout passe par le Worker qui relit les rôles
--  Discord à chaque requête. Une discussion de lead ne doit pas pouvoir
--  se lire en s'adressant directement à Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ── Messagerie interne ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bureau_mails (
  id             BIGSERIAL PRIMARY KEY,
  expediteur_id  TEXT NOT NULL,
  expediteur_nom TEXT,
  expediteur_adr TEXT NOT NULL,
  destinataires  TEXT[] NOT NULL,
  sujet          TEXT,
  corps          TEXT,
  -- Pièces jointes : nom, type et contenu ou lien. Le Worker limite la taille.
  pieces         JSONB NOT NULL DEFAULT '[]'::jsonb,
  lu_par         TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bureau_mails_dest ON bureau_mails USING GIN (destinataires);
CREATE INDEX IF NOT EXISTS bureau_mails_date ON bureau_mails (created_at DESC);

-- ── Discussions de division ─────────────────────────────────────────
-- portee : 'global' (toute la division) ou 'lead' (encadrement seul).
CREATE TABLE IF NOT EXISTS bureau_messages (
  id          BIGSERIAL PRIMARY KEY,
  division    TEXT NOT NULL,
  portee      TEXT NOT NULL DEFAULT 'global',
  contact_id  BIGINT,
  auteur_id   TEXT NOT NULL,
  auteur_nom  TEXT,
  auteur_role TEXT,
  texte       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bureau_messages_portee CHECK (portee IN ('global', 'lead', 'contact'))
);
CREATE INDEX IF NOT EXISTS bureau_messages_fil
  ON bureau_messages (division, portee, created_at DESC);
CREATE INDEX IF NOT EXISTS bureau_messages_contact
  ON bureau_messages (contact_id, created_at ASC);

-- ── Documents de division ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bureau_documents (
  id           BIGSERIAL PRIMARY KEY,
  division     TEXT NOT NULL,
  titre        TEXT NOT NULL,
  description  TEXT,
  lien         TEXT,
  contenu      TEXT,
  type         TEXT NOT NULL DEFAULT 'note',
  ajoute_par   TEXT,
  ajoute_id    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bureau_documents_div
  ON bureau_documents (division, created_at DESC);

-- ── Prises de contact ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bureau_contacts (
  id            BIGSERIAL PRIMARY KEY,
  division      TEXT NOT NULL,
  sujet         TEXT NOT NULL,
  ouvert_par    TEXT,
  ouvert_par_id TEXT NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'ouvert',
  ferme_par     TEXT,
  ferme_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  maj_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bureau_contacts_statut CHECK (statut IN ('ouvert', 'en cours', 'ferme'))
);
CREATE INDEX IF NOT EXISTS bureau_contacts_div
  ON bureau_contacts (division, statut, maj_at DESC);

-- ── Annonces du bureau ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bureau_annonces (
  id         BIGSERIAL PRIMARY KEY,
  division   TEXT,
  titre      TEXT NOT NULL,
  corps      TEXT,
  auteur     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Verrouillage ────────────────────────────────────────────────────
ALTER TABLE bureau_mails     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bureau_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bureau_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bureau_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bureau_annonces  ENABLE ROW LEVEL SECURITY;
