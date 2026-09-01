# AEGIS - specification pour reproduction

Tout ce qu'il faut pour refaire AEGIS a l'identique sur un autre site.
Ecrit depuis le code en service, pas de memoire.

Source : `sasp/liaisons/index.html`, **3 808 lignes**, page autonome.

---

## 1. Ce que c'est

Un **tableau de liaisons d'enquete** : un panneau de liege sur lequel on
epingle des fiches - personnes, vehicules, lieux, preuves - et qu'on relie
par des ficelles portant un libelle et un niveau de certitude.

Ce n'est pas un organigramme ni un diagramme : c'est l'outil que les
enqueteurs connaissent, avec ses polaroids, ses post-it et ses punaises.
Cette fidelite visuelle n'est pas cosmetique, c'est ce qui le rend
immediatement lisible par des gens qui n'ont recu aucune formation.

Il porte en plus : plusieurs dossiers d'enquete, un repertoire, un
inventaire des preuves et mandats, un journal d'activite, une saisie
rapide en langage courant, un export PNG et JSON, et une administration
des droits dossier par dossier.

---

## 2. L'architecture, et ce qu'elle impose

**Une seule page HTML, autonome.** Tout son CSS et tout son JavaScript
sont dedans. Deux dependances externes seulement :

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

La premiere sert a la connexion Discord, la seconde a l'export PNG.

**Aucune donnee en dur.** La page arrive vide et demande tout a l'API. Ce
n'est pas un choix esthetique : sur un hebergement statique, **la page ne
peut pas etre protegee**. N'importe qui la telecharge. La protection porte
donc entierement sur les **donnees**, verifiees a chaque requete.

**Consequence a ne jamais oublier en la reproduisant :** si vous mettez la
moindre donnee sensible dans le HTML - une liste de roles, un identifiant,
un nom de dossier - vous la publiez. Les identifiants de roles autorises
vivent **cote serveur uniquement** ; le front se contente de demander a
l'API et d'afficher ce qu'elle veut bien rendre.

---

## 3. Le modele de donnees

Deux structures, et rien d'autre. Tout le reste en decoule.

### Un noeud

```js
{
  id: 'n17',        // 'n' + compteur, unique dans le dossier
  t:  'suspect',    // la cle du type, voir section 4
  r:  -3,           // rotation en degres, l'inclinaison de la fiche
  x:  420, y: 180,  // position sur le liege
  ech: 1.4,         // echelle, pour mettre une fiche en evidence
  image: 'data:image/...',   // facultatif, la photo
  imgx: 50, imgy: 40, imgz: 120,   // cadrage de l'image, en %
  d: {              // les champs, selon le type
    prenom: 'Ramon', nom: 'Montoya',
    situation: 'En fuite', arme: 'Confirme'
  }
}
```

### Une arete

```js
{
  id: 'e42',
  a:  'n17',        // noeud de depart
  b:  'n23',        // noeud d'arrivee
  l:  'Chef de',    // le libelle, pris dans la liste des relations
  d:  'Constate lors de la filature du 12/08',   // detail libre
  dt: '2026-08-12',
  w:  'hot'         // le niveau de certitude
}
```

### Les quatre niveaux de certitude

```js
const WEIGHT = [
  ['',     'Neutre',      '#3A4B60'],
  ['cool', 'Verifie',     '#5B8FC7'],
  ['warm', 'A confirmer', '#D2811F'],
  ['hot',  'Critique',    '#C4392C']
];
```

Ils colorent la ficelle. C'est ce qui distingue un fait etabli d'une
hypothese, et c'est la premiere chose que regarde un lecteur.

### L'etat de la page

```js
const S = {
  nodes: [], edges: [],
  sel: null, selEdge: null,       // ce qui est selectionne
  hidden: new Set(),              // types masques par la legende
  collapsed: new Set(),
  seq: 100,                       // compteur d'identifiants
  version: 1                      // le verrou optimiste, voir section 7
};
```

---

## 4. Le schema des types

**24 types**, ranges en 6 familles. C'est le coeur de l'outil : chaque
type decide de ses champs, de son apparence et de ce qui s'affiche sur la
fiche.

| Famille | Types |
|---|---|
| Personnes | Personne, Suspect, Victime, Temoin, Agent |
| Organisations | Organisation, Groupe criminel |
| Biens et objets | Vehicule, Propriete, Lieu, Arme |
| Communications et finances | Telephone, Compte bancaire, Transaction |
| Faits | Evenement, Infraction, Condamnation |
| Dossier et pieces | Enquete, Preuve, Photo, Document, Declaration, Mandat, Mouvement de scelle |

### La declaration d'un type

```js
suspect: {
  l:  'Suspect',                  // le libelle
  g:  'Personnes',                // la famille
  c:  '#D9584A',                  // la couleur de la punaise et du cadre
  ic: 'suspect',                  // l'icone, voir la liste ICONES
  p:  'polaroid',                 // le support, voir SUPPORTS
  titre: ['prenom', 'nom'],       // ce qui fait le titre de la fiche
  carte: [['SITUATION','situation'], ['ALIAS','alias']],  // les 2 lignes visibles
  f: [                            // les champs du formulaire
    { k:'prenom', l:'Prenom', t:'t' },
    { k:'situation', l:'Situation', t:'s',
      o: SEL('Libre','Recherche','En fuite','Garde a vue') },
    { k:'mo', l:'Mode operatoire', t:'ta', full:1 },
    NOTE
  ]
}
```

**Les types de champ** : `t` texte, `ta` zone de texte, `d` date, `n`
nombre, `s` liste deroulante (avec `o`). `full:1` occupe toute la largeur,
`mono:1` affiche en chasse fixe.

### Les cinq supports

```js
const SUPPORTS = [
  ['polaroid','Polaroid'], ['photo','Photo'], ['sticky','Post-it'],
  ['card','Fiche cartonnee'], ['sheet','Feuille']
];
```

### Les icones disponibles

```js
const ICONES = ['person','suspect','victim','witness','shield','org','gang',
 'car','house','place','phone','bank','gun','evid','photo','doc','event',
 'case','warrant','speech','gavel','scale','swap','route','chart','web',
 'book','gear','link','key','alert'];
```

### Les 44 relations proposees

```js
const REL_BASE = ['Membre de','Chef de','Employe par','Proprietaire de',
 'Detient','Titulaire de','Utilise la ligne','A appele','A rencontre',
 'A vendu a','A transfere de l\'argent a','Habite a','Domicilie a','Occupe',
 'Present sur les lieux','Vehicule utilise pendant','Suspecte de',
 'Victime de','Temoin de','Participe a','Activite du groupe',
 'Auteur de la declaration','Declaration recueillie par','Porte sur',
 'Contredit','Corrobore','Condamne pour','Mis en cause pour',
 'Infraction du dossier','Emise depuis','Creditee sur',
 'Mouvement du scelle','Effectue par','Preuve retrouvee chez',
 'Decouverte a','Saisie par','Redige par','Objet du mandat',
 'Rattache au dossier','Associe a','En conflit avec','Protege','Fournit',
 'Referent du dossier'];
```

### Le schema est modifiable en service

`SCHEMA_BASE` n'est qu'un **point de depart**. Le schema reel vit en base,
dans `liaisons_schema`, et l'ecran « Types d'elements » permet d'ajouter un
type, d'en modifier les champs, de reordonner, de creer des familles et
des relations - **sans deployer**.

Trois fonctions font le lien :

- `construireSchema()` : reconstruit les index depuis les donnees
- `appliquerSchema(paquet)` : installe un schema recu de l'API
- `paquetActuel()` : rend `{types, familles, relations}` a enregistrer

---

## 5. Le schema SQL

Cinq tables. Le SQL ci-dessous est en Postgres ; les correspondances
SQLite sont a la fin.

```sql
-- Les dossiers d'enquete
CREATE TABLE liaisons_tableaux (
  id            BIGSERIAL PRIMARY KEY,
  nom           TEXT NOT NULL DEFAULT 'Nouveau dossier',
  dossier       TEXT,                              -- le regroupement
  nodes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges         JSONB NOT NULL DEFAULT '[]'::jsonb,
  seq           INTEGER NOT NULL DEFAULT 100,
  -- Incremente a chaque ecriture : c'est le verrou optimiste.
  version       INTEGER NOT NULL DEFAULT 1,
  acces_defaut  TEXT NOT NULL DEFAULT 'ecriture'
                CHECK (acces_defaut IN ('ecriture','lecture','refus')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Le schema des types, une seule ligne
CREATE TABLE liaisons_schema (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  data        JSONB,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  CONSTRAINT liaisons_schema_ligne_unique CHECK (id = 1)
);

-- Les droits, dossier par dossier et personne par personne
CREATE TABLE liaisons_droits (
  tableau_id  BIGINT NOT NULL REFERENCES liaisons_tableaux(id) ON DELETE CASCADE,
  discord_id  TEXT   NOT NULL,
  niveau      TEXT   NOT NULL CHECK (niveau IN ('ecriture','lecture','refus')),
  nom         TEXT,
  ajoute_par  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tableau_id, discord_id)
);
CREATE INDEX liaisons_droits_par_personne ON liaisons_droits (discord_id);

-- Les acces nominatifs a l'outil, hors roles
CREATE TABLE liaisons_acces (
  discord_id  TEXT PRIMARY KEY,
  nom         TEXT,
  peut_ecrire BOOLEAN NOT NULL DEFAULT true,
  ajoute_par  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Qui a fait quoi
CREATE TABLE liaisons_journal (
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
CREATE INDEX liaisons_journal_tableau_idx
  ON liaisons_journal (tableau_id, created_at DESC);
```

**Les cinq tables ont RLS active SANS AUCUNE POLICY.** Rien n'est lisible
depuis le navigateur, meme avec la cle anon. Seul le serveur, qui porte la
cle service, y accede.

**Ne jamais ajouter de policy `authenticated`** : cela contournerait d'un
coup toute la verification des roles. C'est la faute la plus facile a
commettre et la plus difficile a voir.

**En SQLite** : `BIGSERIAL` devient `INTEGER PRIMARY KEY`, `JSONB` devient
`TEXT` serialise, `TIMESTAMPTZ` devient `TEXT` en ISO 8601 UTC, `BOOLEAN`
devient `INTEGER` 0 ou 1. Pas de RLS, et il n'en faut pas : le fichier
n'est lisible que par le serveur.

---

## 6. Le contrat d'API

Sept routes, toutes sous `/api/sasp/`. **Aucune ne rend quoi que ce soit
avant d'avoir verifie les roles.**

| Methode | Route | Ce qu'elle fait |
|---|---|---|
| GET | `/api/sasp/acces` | Qui suis-je, et qu'ai-je le droit de faire |
| GET | `/api/sasp/tableaux` | La liste des dossiers **visibles pour moi** |
| GET | `/api/sasp/board/:id` | Le contenu d'un dossier |
| PUT | `/api/sasp/board/:id` | L'enregistrer |
| GET/PUT | `/api/sasp/board/:id/droits` | Les droits nominatifs du dossier |
| GET/PUT | `/api/sasp/schema` | Le schema des types |
| GET | `/api/sasp/membres` | Les gens du serveur, pour attribuer un droit |
| GET/POST/DELETE | `/api/sasp/comptes` | Les acces nominatifs a l'outil |
| GET | `/api/sasp/journal?tableau=:id` | Le journal |

**Un dossier ferme ne figure pas dans la liste.** En montrer le nom
reviendrait a publier l'existence d'une enquete a qui n'y a pas droit.
C'est un detail qui compte : la liste elle-meme est une information.

---

## 7. Le controle d'acces

Trois couches, dans cet ordre.

**1. Ouvrir l'outil.** Deux roles Discord, plus des acces nominatifs en
base (`liaisons_acces`). La liste des roles fait autorite **cote serveur
uniquement** :

```js
const LIAISONS_ROLES = [
  { id: '1500975725153620033', nom: 'Command Staff' },
  { id: '1501526499910746132', nom: 'Lead CID' }
];
```

**2. Ouvrir un dossier.** Chaque dossier a un `acces_defaut` parmi
`ecriture`, `lecture`, `refus`, que des droits nominatifs
(`liaisons_droits`) peuvent surcharger personne par personne.

La fonction `liaisonsDroitSur(env, qui, tableauId, tableau)` tranche.
**Elle a ete essayee sur ses onze cas** avant mise en service.

Deux regles a ne pas perdre en reproduisant :
- **Qui peut gerer a toujours l'ecriture.** Sinon un administrateur peut
  se fermer un dossier a lui-meme et ne plus pouvoir revenir.
- **`refus` masque le dossier de la liste**, il ne se contente pas de
  refuser l'ouverture.

**3. Ecrire.** Verrou optimiste sur `version`. Le client envoie la version
qu'il a lue ; si elle a change, le serveur rend **409** et le client
propose de recharger. Sans cela, deux enqueteurs sur le meme dossier
s'ecrasent mutuellement sans le savoir.

**Fail-closed.** Contrairement a la verification de roles du reste du
site, qui retombe sur un role memorise quand Discord ne repond pas, AEGIS
**refuse** dans ce cas. Un outil d'enquete qui s'ouvre parce que Discord
est en panne, c'est pire que pas d'outil.

---

## 8. Les ecrans

Huit vues, routees par le fragment d'URL (`#/dash`, `#/board`, ...).

| Route | Ecran |
|---|---|
| `#/dash` | Tableau de bord : les chiffres, les dossiers recents |
| `#/cases` | Enquetes : la liste des dossiers |
| `#/board` | **Le tableau de liaisons**, le coeur |
| `#/dir` | Repertoire : toutes les fiches, filtrables |
| `#/evidence` | Preuves et mandats |
| `#/types` | Types d'elements : modifier le schema |
| `#/log` | Journal d'activite |
| `#/admin` | Administration : comptes et droits |

### Ce que fait le tableau

- **Deplacer, zoomer** sur un liege de 24 000 px de cote
- **Poser une fiche** : clic droit, ou saisie rapide
- **Tirer une ficelle** entre deux fiches, avec libelle et certitude
- **Inspecter** : le panneau de droite edite tous les champs du type
- **Incliner, redimensionner** une fiche pour la mettre en evidence
- **Cadrer une image** dans son polaroid, en trois curseurs
- **Legende** : masquer ou montrer une famille entiere
- **Hierarchie** : un organigramme automatique d'un groupe criminel,
  exportable en PNG
- **Export PNG** du tableau entier, **export/import JSON**
- **Saisie rapide** : une ligne par fiche, en langage courant

### La saisie rapide

Elle merite d'etre reprise, c'est ce qui fait gagner le plus de temps.
On ecrit :

```
Ramon Montoya, suspect, en fuite
Les Black King, groupe criminel
Ramon Montoya est chef de Les Black King
```

et l'outil cree les fiches et les liaisons. Un analyseur de phrases
francaises reconnait les articles, les verbes usuels et les relations
declarees dans le schema.

---

## 9. Les pieges qui ont deja coute cher

Ils sont tous vecus. Les lire vaut mieux que les redecouvrir.

**Le SVG des ficelles doit avoir une taille explicite.** Sans `width` et
`height`, il vaut 300x150 par defaut et **aucune ficelle ne s'affiche** -
ni a l'ecran, ni a l'export. La solution : une surface de 24 000 px
decalee de moitie.

```css
#gedges { position:absolute; left:-12000px; top:-12000px;
          width:24000px; height:24000px; overflow:visible;
          pointer-events:none }
```
```html
<svg id="gedges"><g transform="translate(12000,12000)">
  <g id="glinks"></g><g id="glabels"></g></g></svg>
```

**L'export PNG ne rend pas le SVG.** `html2canvas` ignore les elements
SVG. Il faut **repeindre les ficelles au canvas** apres coup, avec une
fonction dediee (`ficellesSurCanvas`). Meme raison pour l'organigramme :
il est dessine en canvas et non rasterise, sinon les polices manquent.

**Les liaisons de la saisie rapide etaient perdues en silence.** Un noeud
etait pousse a la fois dans `S.nodes` et dans la liste des nouveaux ;
`S.nodes.concat(crees)` voyait donc **deux correspondances**, concluait a
une ambiguite, et abandonnait la liaison sans rien dire. Dedupliquer sur
l'identifiant, et **signaler les liaisons non posees** plutot que de les
laisser disparaitre.

**`String.replace` mange les `$$`.** Dans le texte de remplacement, `$$`
vaut `$`, `$&` la correspondance. Un patch a transforme `$$('#x')` en
`$('#x')`, produisant une `TypeError` qui coupait une fonction en plein
milieu et desactivait tout ce qui suivait, **sans message**. Toujours
passer une fonction : `s.replace(avant, () => apres)`.

**Le preflight CORS peut etre global.** Si le serveur repond a tous les
`OPTIONS` en tete de `fetch()`, un bloc `OPTIONS` dans une route est
mort-ne. Tout nouvel en-tete doit etre declare dans ce gestionnaire
global. Et **verifier le code 204 ne prouve rien** : il faut lire
`access-control-allow-headers`.

**La molette doit defiler dans le panneau, pas dezoomer.** Sans garde, le
gestionnaire de zoom capte la molette meme au-dessus de la fiche ouverte.

---

## 10. Le reproduire ailleurs

**Ce qui se reprend tel quel :** le fichier HTML entier. Il est autonome.

**Ce qu'il faut adapter, dans l'ordre :**

1. **La connexion.** La page charge `../../config.js` pour l'adresse
   Supabase et la cle anon, et attend un jeton. Remplacez par votre propre
   mecanisme : ce que le code veut, c'est un en-tete `Authorization`.

2. **Les sept routes API.** Le contrat de la section 6. Le front ne
   connait rien d'autre.

3. **Les cinq tables.** La section 5, telle quelle.

4. **Les roles.** `LIAISONS_ROLES` cote serveur, et **jamais dans le
   front**.

5. **Les chemins relatifs** : `../../assets/sasp-sud-logo.png`,
   `../../index.html`, `../../config.js`. Trois references a repointer.

6. **Le schema des types.** `SCHEMA_BASE` est un point de depart pensé
   pour une police. Pour un autre metier, changez les 24 types - c'est
   prevu, et l'ecran « Types d'elements » le fait sans deployer.

**Ce qu'il ne faut pas changer sans y reflechir :** le verrou optimiste,
le fail-closed, le fait qu'un dossier en `refus` disparaisse de la liste,
et la taille explicite du SVG. Chacun des quatre repond a une panne qui a
eu lieu.

**Compter une journee** pour un portage a l'identique avec une API deja
en place. Le gros du temps part dans l'authentification et les droits, pas
dans le tableau.
