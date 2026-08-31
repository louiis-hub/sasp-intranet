-- Gestion globale des acces
--
-- A executer A LA MAIN dans l'editeur SQL de Supabase. Aucune migration
-- n'est jouee automatiquement sur ce projet.
--
-- Jusqu'ici, qui accede a quoi etait ecrit en dur dans worker.js et
-- config.js. Ces trois tables le sortent du code pour que le Command
-- Staff puisse le regler depuis le site.
--
-- Le code garde ses valeurs actuelles comme repli : si ces tables sont
-- vides ou injoignables, rien ne change. On n'ouvre jamais d'acces par
-- accident, on garde le dernier etat connu.

-- ── les divisions et unites ────────────────────────────────────────
create table if not exists config_divisions (
  code        text primary key,
  nom         text not null,
  adr         text not null,           -- la partie avant @sasp.com
  ic          text,                    -- l'emoji affiche
  roles       jsonb not null default '[]'::jsonb,   -- roles membres
  lead        jsonb not null default '[]'::jsonb,   -- roles encadrement
  colead      jsonb not null default '[]'::jsonb,   -- roles adjoints
  ordre       int  not null default 100,
  actif       boolean not null default true,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- ── qui ouvre quelle application ───────────────────────────────────
-- cle : 'poste', 'aegis', 'admin', 'supervision'
create table if not exists config_acces (
  cle         text primary key,
  libelle     text not null,
  roles       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- ── ce qui a ete change, par qui ───────────────────────────────────
-- Une modification d'acces sans trace, c'est une modification que
-- personne n'assume.
create table if not exists config_journal (
  id          bigserial primary key,
  quand       timestamptz default now(),
  qui         text,
  qui_id      text,
  ip          text,
  action      text not null,
  cible       text,
  avant       jsonb,
  apres       jsonb
);

create index if not exists config_journal_quand_idx on config_journal (quand desc);

-- ── verrouillage ───────────────────────────────────────────────────
-- RLS active SANS AUCUNE POLICY : rien n'est lisible depuis le
-- navigateur, meme avec la cle anon. Seul le serveur, qui porte la cle
-- service, y accede. Ne JAMAIS ajouter de policy « authenticated » :
-- cela contournerait d'un coup toute la verification des roles Discord.
alter table config_divisions enable row level security;
alter table config_acces     enable row level security;
alter table config_journal   enable row level security;

-- ── etat de depart : exactement ce que le code applique aujourd'hui ─
-- Reprise fidele de BUREAU_DIVISIONS, corrigee le 31 aout 2026 sur
-- l'export reel des roles Discord.
insert into config_divisions (code, nom, adr, ic, roles, lead, colead, ordre) values
  ('PA',   'Police Academy',              'academy',  '🎓',
   '["1518631032167993534","1523753182457495653","1527820344558354613"]', '["1518632035911205168"]', '[]', 10),
  ('CID',  'Criminal Investigation Div.', 'cid',      '🗂️',
   '["1501526844959363114"]', '["1501526499910746132"]', '["1529286790521819267"]', 20),
  ('SWAT', 'Special Weapons & Tactics',   'swat',     '🛡️',
   '["1504449839000326344"]', '["1504450026393309276"]', '[]', 30),
  ('FTF',  'Fugitive Task Force',         'ftf',      '🎯',
   '["1528370972153872515"]', '["1528370954319822949"]', '[]', 40),
  ('TU',   'Traffic Unit',                'traffic',  '🚦',
   '["1501525276813955253","1501525793640022017","1501525992605487275"]', '["1501522839717679185"]', '["1501525042037788772"]', 50),
  ('CNU',  'Crisis & Negotiation Unit',   'cnu',      '🤝',
   '["1519495087963246733"]', '["1519495585487388773"]', '["1519495090798858322","1519495618060619877"]', 60),
  ('K9',   'Unite cynophile K9',          'k9',       '🐕',
   '["1535392448187072632","1535392294570692628"]', '["1535392140140748820"]', '["1535392215889870869"]', 70),
  ('IA',   'Affaires Internes',           'intel',    '🔎',
   '["1514523559127548016"]', '["1524117754725007422"]', '[]', 80),
  ('SYND', 'Syndicat',                    'syndicat', '⚖️',
   '["1519496680397869147"]', '["1519496676539109486"]', '[]', 90),
  ('LP',   'Lincoln Patrol',              'lincoln',  '🚓',
   '["1519688600395055154"]', '[]', '[]', 100)
on conflict (code) do nothing;

insert into config_acces (cle, libelle, roles) values
  ('poste',       'Ouvrir le poste de travail',
   '["1501250580058870104"]'),
  ('aegis',       'Ouvrir AEGIS',
   '["1500975725153620033","1501526499910746132"]'),
  ('supervision', 'Supervisor Team',
   '["1504452141518032956"]'),
  ('admin',       'Administrer les acces',
   '["1500975725153620033"]')
on conflict (cle) do nothing;

-- Le role Command Staff reste cable en dur dans worker.js comme
-- plancher : il ne peut pas etre retire d'ici. Sans ce garde-fou, une
-- fausse manoeuvre sur la ligne « admin » fermerait la porte a tout le
-- monde, sans aucun moyen de revenir en arriere depuis le site.
