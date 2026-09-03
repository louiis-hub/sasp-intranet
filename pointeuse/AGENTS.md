# Construire une pointeuse et un systeme de tickets Discord

Consigne pour un agent. A deposer a la racine du projet ou ces systemes
doivent etre construits.

**Ce qui est demande : les refaire, pas les copier.** Il n'y a aucune
donnee a reprendre, aucune base a migrer. On repart d'une base vide sur
un autre serveur Discord.

Deux parties, independantes l'une de l'autre :

- **partie A**, la pointeuse : sections 1 a 10 ;
- **partie B**, les tickets : sections B1 a B8.

Construire celle dont vous avez besoin, ou les deux.

Tout ce qui suit decrit un systeme qui tourne en production depuis
plusieurs mois. Les valeurs, les structures et les pieges sont releves
dessus, pas imagines.

---
---

# Partie A - La pointeuse

---

## 1. Ce qu'il faut construire

Un **message permanent** dans un salon Discord, avec deux boutons : prise
de service, fin de service. Il affiche qui est en service et se
rafraichit tout seul.

**Le probleme a resoudre n'est pas de compter des heures.** C'est
l'utilisateur qui oublie de pointer sa fin de service et laisse tourner
huit heures pour rien. Si vous ne construisez que les deux boutons, vous
n'avez rien construit d'utile : c'est la mecanique de confirmation qui
fait le systeme.

---

## 2. Le mecanisme anti-oubli

**A construire en premier. Le reste en decoule.**

```js
const CONFIRM_APRES_MS      = 5 * 60 * 60 * 1000;   // premiere demande
const CONFIRM_REPETITION_MS = 2 * 60 * 60 * 1000;   // puis toutes les
const CONFIRM_DELAI_MS      =     15 * 60 * 1000;   // pour repondre
const PENALITE_JAMAIS_MS    = 4 * 60 * 60 * 1000;   // retranchee
const PENALITE_CONFIRME_MS  = 1 * 60 * 60 * 1000;   // retranchee
```

Une tache periodique passe **toutes les 15 minutes** sur les services
ouverts :

1. Au bout de **5 h**, envoyer un message prive avec un bouton
   « toujours en service ». Puis toutes les **2 h**.
2. Laisser **15 minutes** pour repondre.
3. Passe ce delai, fermer le service - **mais pas a l'heure courante**.

**La penalite est le point le plus important de tout le systeme :**

| Situation | Retenue |
|---|---|
| N'avait **jamais** confirme | **4 h** |
| Avait **deja** confirme au moins une fois | **1 h** |

**Ne pas simplifier en une penalite unique.** Sans cette distinction, on
punit de la meme facon celui qui a laisse tourner toute la nuit et celui
qui a confirme de bonne foi puis s'est deconnecte cinq minutes apres. Un
systeme percu comme injuste est un systeme que les gens contournent.

Prevoir aussi une fermeture hebdomadaire de tout ce qui traine encore
ouvert, une fois par semaine.

---

## 3. Le rattrapage

Une pointeuse automatique se trompe. **Sans porte de sortie, l'encadrement
passe ses semaines a arbitrer a la main.**

Le message prive porte un troisieme bouton, « Reclamer des heures », qui
ouvre un formulaire :

- nombre d'heures demandees
- **motif obligatoire**

La demande part dans un salon reserve a l'encadrement, avec trois
boutons :

- **Valider** les heures demandees
- **Saisir un autre nombre** d'heures - c'est celui qui sert le plus
- **Refuser**

Fenetre de reclamation : **48 h**. Au-dela, desactiver le bouton et
renvoyer vers l'encadrement.

**Une seule correction par personne et par semaine**, garantie par une
contrainte d'unicite en base. Deux lignes se cumuleraient sans que
personne ne le voie.

---

## 4. Le schema

Deux tables. Ecrites en Postgres ; adapter si vous utilisez autre chose.

```sql
create table pointages (
  id                        bigserial primary key,
  utilisateur_id            bigint not null,      -- la fiche interne
  discord_id                text,                 -- l'identifiant Discord

  clock_in                  timestamptz not null default now(),
  clock_out                 timestamptz,

  -- null = l'utilisateur a clique sur « fin de service » lui-meme
  --   AUTO_MOINS_4H  ferme d'office, jamais confirme
  --   AUTO_MOINS_1H  ferme d'office, avait deja confirme
  --   AUTO_SEMAINE   ferme par la tache hebdomadaire
  clockout_reason           text,

  -- La duree reellement decomptee, penalite comprise. Distincte de
  -- l'ecart entre clock_in et clock_out, qui est la duree brute.
  total_duration_seconds    integer,

  next_confirmation_at      timestamptz,
  -- Non nul = une demande est partie et le compte a rebours tourne.
  confirmation_requested_at timestamptz,
  last_confirmation_at      timestamptz,
  confirmation_count        integer not null default 0,
  -- Pour retrouver le message prive et desactiver ses boutons.
  confirmation_channel_id   text,
  confirmation_message_id   text
);

-- La tache ne lit que les services ouverts : sans index partiel, elle
-- parcourt tout l'historique toutes les 15 minutes.
create index idx_pointages_actifs
  on pointages (clock_out, next_confirmation_at, confirmation_requested_at)
  where clock_out is null;

create index idx_pointages_discord on pointages (discord_id);

create table pointeuse_corrections (
  id               bigserial primary key,
  semaine_key      text not null,
  utilisateur_id   text not null,
  minutes_retires  integer not null default 0,   -- negatif = crediter
  motif            text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  unique (semaine_key, utilisateur_id)
);
```

---

## 5. Les structures Discord exactes

Reproduire ces formes telles quelles : elles sont deja eprouvees.

### Le message permanent

```js
{
  embeds: [{
    title: "Tableau de service",
    description: nb > 0
      ? `**En service · ${nb} agent${nb > 1 ? "s" : ""}**\n${liste}`
      : "*Aucun agent en service*",
    color: nb > 0 ? 0x3A9B4E : 0x3A4E64,
    footer: { text: "Mis a jour automatiquement" },
    timestamp: new Date().toISOString()
  }],
  components: [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Prise de service",
        emoji: { name: "🟢" }, custom_id: "prise_service" },
      { type: 2, style: 4, label: "Fin de service",
        emoji: { name: "🔴" }, custom_id: "fin_service" }
    ]
  }]
}
```

### Le message prive de confirmation

```js
{
  embeds: [{
    title: "Pointeuse",
    description: "Vous etes en service depuis bientot 5 heures.\nEtes-vous toujours en service ?",
    color: 0x3A9B4E,
    fields: [
      // <t:...:f> affiche l'heure dans le fuseau du lecteur. Ne pas
      // ecrire une heure en clair : chacun est dans un fuseau different.
      { name: "Prise de service",
        value: `<t:${Math.floor(new Date(p.clock_in).getTime() / 1000)}:f>` },
      { name: "Delai de reponse", value: "15 minutes", inline: true }
    ]
  }],
  components: [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Oui, je suis toujours en service",
        custom_id: `confirm_oui|${p.id}` },
      { type: 2, style: 4, label: "Non, terminer mon service",
        custom_id: `confirm_non|${p.id}` },
      { type: 2, style: 1, label: "Reclamer des heures",
        custom_id: `reclamer|${p.id}` }
    ]
  }]
}
```

### Le routage des interactions

```js
if (id === "prise_service" || id === "fin_service") {
  await boutonService(env, interaction, id);
  return json({ type: 6 });     // 6 = accuse reception, sans reponse visible
}
if (id.startsWith("confirm_oui|") || id.startsWith("confirm_non|"))
  return json(await boutonConfirmation(env, interaction, id));
if (id.startsWith("reclamer|"))
  return json(formulaireReclamation(id));   // type 9 = modale
```

---

## 6. Reconnaitre la personne

**Par son identifiant Discord, jamais par son pseudo.** Un pseudo change,
un identifiant non.

Ordre a suivre :

1. chercher `discord_id` dans la table des utilisateurs ;
2. a defaut, tenter de lire un identifiant dans le pseudo du serveur,
   si votre convention en porte un ;
3. sinon **refuser en disant quoi faire** : « Votre compte Discord n'est
   lie a aucune fiche. Renseignez-le dans votre profil. »

Le troisieme point n'est pas un detail. Un refus muet fait revenir la
personne vers vous ; un refus qui explique la renvoie vers la solution.

---

## 7. Les pieges

Ils sont tous vecus. Les lire coute cinq minutes, les redecouvrir coute
une journee.

**Le `custom_id` Discord est plafonne a 100 caracteres.** Un depassement
**echoue en silence** : le bouton ne fait simplement rien. Raccourcir les
prefixes et appliquer `.slice(0, 100)` partout.

**Le double pointage arrive.** Un double clic, ou deux identites qui se
rejoignent. La fonction qui cherche les services ouverts doit rendre une
**liste**, pas une ligne, et la fermeture doit fermer **tous** les
pointages ouverts, pas seulement le premier.

**Le fuseau se calcule, il ne se code pas en dur.** Utiliser
`Intl.DateTimeFormat` avec la zone voulue. Un decalage fixe se trompe la
moitie de l'annee, et la tache hebdomadaire part une heure a cote pendant
six mois.

**Un message prive peut echouer.** Quelqu'un qui a ferme ses DM ne recoit
rien. Attraper l'erreur, la journaliser, et **ne pas fermer le service**
pour autant. Fermer d'office quelqu'un qu'on n'a pas pu prevenir est la
meilleure facon de faire detester le systeme.

**La tache periodique est le point de defaillance unique.** Si elle ne
tourne pas, aucune confirmation ne part et les services restent ouverts
sans penalite. La surveiller en priorite, et prevoir un interrupteur si
elle risque de tourner en double pendant une migration.

**Le salon et le message vont par paire.** Le message permanent doit
exister dans le salon configure, sinon le rafraichissement echoue toutes
les 15 minutes, silencieusement.

---

## 8. L'ordre de construction

1. Les deux tables.
2. Les deux boutons, la prise et la fin de service. Verifier qu'un
   deuxieme clic sur « prise » ne cree pas un second pointage.
3. Le message permanent et son rafraichissement.
4. La tache des 15 minutes, **sans penalite pour commencer** : elle se
   contente d'envoyer les demandes de confirmation.
5. Les boutons de confirmation.
6. **Puis seulement** la fermeture d'office et ses deux penalites.
7. La reclamation d'heures.
8. La fermeture hebdomadaire.

Faire tourner les etapes 1 a 5 quelques jours avant d'activer la 6. Une
fermeture d'office qui se declenche a tort dans les premiers jours coute
la confiance des utilisateurs, et elle ne se regagne pas.

---

## 9. Regler les constantes

Les valeurs ci-dessus conviennent a des services de 4 a 8 heures.

| Si vos services durent | Premiere demande | Repetition |
|---|---|---|
| 1 a 2 h | 45 min | 30 min |
| 4 a 8 h | **5 h** | **2 h** |
| Plus de 12 h | 6 h | 3 h |

**Ne pas descendre le delai de reponse sous 10 minutes.** Quinze, c'est
deja court pour quelqu'un qui joue : il faut lire le message prive,
changer de fenetre et cliquer. En dessous, vous fermez des services de
gens qui etaient bien la, et vous passez vos semaines a traiter des
reclamations.

---

## 10. Comment verifier que c'est bon

Ne pas se fier a « ca a l'air de marcher ». Ces sept cas couvrent tout ce
qui a deja casse :

1. Prise de service, puis **deuxieme clic** : un seul pointage ouvert.
2. Fin de service sans prise prealable : refus explicite, pas d'erreur.
3. Un utilisateur sans `discord_id` : refus qui dit quoi faire.
4. Confirmation acceptee : `confirmation_count` augmente,
   `confirmation_requested_at` repasse a null.
5. Confirmation ignoree, **jamais confirme** : ferme a 4 h avant l'heure
   courante, `clockout_reason` renseigne.
6. Confirmation ignoree, **avait deja confirme** : ferme a 1 h avant.
7. Deux pointages ouverts pour la meme personne : la fermeture les ferme
   **tous les deux**.

Le cas 6 est celui qu'on oublie, et c'est le plus visible pour les
utilisateurs.

---
---

# Partie B - Le systeme de tickets

Un panneau dans un salon public. On y choisit un service, et le bot cree
un **salon prive** entre le demandeur et ce service.

C'est un remplacant des messages prives a l'encadrement : la conversation
est tracee, plusieurs personnes du service peuvent y repondre, et rien ne
se perd quand celui qui suivait le dossier n'est pas la.

---

## B1. Le deroule

1. Le demandeur choisit un service dans un menu deroulant.
2. Le bot cree un salon, **invisible pour tout le monde sauf** le
   demandeur, le service concerne et le staff.
3. Il y poste un message d'accueil et **mentionne le service**.
4. Quelqu'un du service **prend le ticket en charge** - le statut passe a
   `claimed`, et on sait qui s'en occupe.
5. A la fin, **fermeture en deux temps** : un bouton, puis une
   confirmation.
6. Un ticket ferme peut etre **rouvert**.

---

## B2. Les permissions du salon

C'est la partie ou une erreur se paie cher : une permission trop large
rend une conversation privee lisible par tout le serveur.

Les valeurs sont les bits de Discord :

```js
const VIEW            = 1024n;
const SEND            = 2048n;
const EMBED           = 16384n;
const ATTACH          = 32768n;
const READ_HISTORY    = 65536n;
const MANAGE_CHANNELS = 16n;

const BASE  = String(VIEW | SEND | READ_HISTORY | ATTACH | EMBED);
const STAFF = String(VIEW | SEND | READ_HISTORY | ATTACH | EMBED | MANAGE_CHANNELS);

const permission_overwrites = [
  // Tout le serveur : refuse. C'est cette ligne qui rend le salon prive.
  { id: guildId, type: 0, deny: String(VIEW) },
  // Le demandeur : lire, ecrire, joindre des fichiers.
  { id: userId,  type: 1, allow: BASE },
  // Le staff : les memes droits, plus la gestion du salon.
  ...rolesStaff.map(r => ({ id: r, type: 0, allow: STAFF })),
  // Les roles du service choisi : idem.
  ...rolesDuService.map(r => ({ id: r, type: 0, allow: STAFF }))
];
```

**`type: 0` designe un role, `type: 1` un membre.** Les inverser donne un
salon soit inaccessible, soit ouvert a tous - et Discord ne proteste pas.

**Refuser `VIEW` a `@everyone` d'abord.** Sans cette ligne, le salon
herite des permissions de sa categorie et devient public.

---

## B3. Le nom du salon

Le prendre dans **vos donnees**, pas dans le pseudo Discord.

Chez nous : le nom et le prenom lus dans la fiche de l'agent, avec un
repli sur le pseudo, puis sur les quatre derniers chiffres de
l'identifiant. Un salon nomme d'apres un pseudo devient illisible le jour
ou la personne en change.

Discord impose des noms en minuscules, sans espaces ni accents : prevoir
une fonction qui nettoie.

---

## B4. Le schema

Huit tables. Les cinq premieres suffisent pour un systeme complet ; les
trois dernieres sont du confort.

```sql
-- Le panneau : un par salon d'accueil
create table ticket_panels (
  id                    uuid primary key default gen_random_uuid(),
  guild_id              text not null,
  name                  text not null default 'Panneau tickets',
  channel_id            text,
  message_id            text,
  default_category_id   text,
  component_type        text not null default 'select'
                        check (component_type in ('select','buttons')),
  title                 text not null,
  description           text not null default '',
  placeholder           text default 'Faites un choix',
  log_channel_id        text,
  transcript_channel_id text,
  -- Combien de tickets ouverts une meme personne peut avoir.
  max_tickets_per_user  integer not null default 1,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Les services proposes dans le menu
create table ticket_options (
  id                   uuid primary key default gen_random_uuid(),
  panel_id             uuid not null references ticket_panels(id) on delete cascade,
  key                  text not null,
  label                text not null,
  description          text,
  emoji                text default '🎫',
  category_id          text,
  -- Quand la categorie est pleine : Discord plafonne a 50 salons.
  overflow_category_id text,
  archive_category_id  text,
  -- Qui voit le ticket, qui peut le gerer, qui est mentionne a l'ouverture.
  support_role_ids     text[] not null default '{}',
  manager_role_ids     text[] not null default '{}',
  mention_role_ids     text[] not null default '{}',
  -- Qui a le droit d'en ouvrir un, et qui en est exclu.
  required_role_ids    text[] not null default '{}',
  blocked_role_ids     text[] not null default '{}',
  channel_name_format  text not null default 'ticket-{option}-{user}',
  welcome_title        text,
  welcome_message      text,
  position             integer not null default 0,
  max_tickets_per_user integer,
  enabled              boolean not null default true,
  unique(panel_id, key)
);

-- Les tickets ouverts
create table ticket_tickets (
  id             uuid primary key default gen_random_uuid(),
  guild_id       text not null,
  panel_id       uuid references ticket_panels(id) on delete set null,
  option_id      uuid references ticket_options(id) on delete set null,
  channel_id     text not null,
  ticket_number  integer,
  requester_id   text not null,
  requester_name text,
  status         text not null default 'open'
                 check (status in ('open','claimed','closed','archived')),
  claimed_by     text,
  claimed_at     timestamptz,
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      text,
  close_reason   text,
  transcript_url text
);

-- Les questions posees avant l'ouverture, service par service
create table ticket_questions (
  id          uuid primary key default gen_random_uuid(),
  option_id   uuid not null references ticket_options(id) on delete cascade,
  label       text not null,
  placeholder text,
  required    boolean not null default false,
  input_type  text not null default 'short'
              check (input_type in ('short','paragraph')),
  position    integer not null default 0
);

create table ticket_answers (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references ticket_tickets(id) on delete cascade,
  question_id uuid references ticket_questions(id) on delete set null,
  label       text not null,     -- recopie : la question peut etre modifiee ensuite
  answer      text
);

-- Confort
create table ticket_members (
  id        uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ticket_tickets(id) on delete cascade,
  user_id   text not null,
  added_by  text,
  unique(ticket_id, user_id)
);

create table ticket_logs (
  id        uuid primary key default gen_random_uuid(),
  ticket_id uuid references ticket_tickets(id) on delete set null,
  action    text not null,
  actor_id  text,
  details   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table ticket_blacklist (
  id       uuid primary key default gen_random_uuid(),
  guild_id text not null,
  user_id  text not null,
  reason   text,
  unique(guild_id, user_id)
);

create index ticket_tickets_requester_idx
  on ticket_tickets (guild_id, requester_id, status);
```

**`ticket_answers.label` recopie l'intitule de la question**, il ne se
contente pas d'y renvoyer. Une question modifiee six mois plus tard
rendrait sinon illisibles toutes les reponses passees.

---

## B5. Les boutons

| `custom_id` | Ce qui se passe |
|---|---|
| `ticket_open_select` | le menu du panneau |
| `ticket_claim\|id` | quelqu'un prend le ticket en charge |
| `ticket_close\|id` | demande la fermeture |
| `ticket_confirm_close\|id` | confirme |
| `ticket_reopen\|id` | rouvre |

**La fermeture se fait en deux temps.** Un seul bouton, et des tickets se
ferment par erreur de clic - avec la conversation qui disparait pour le
demandeur.

---

## B6. Les pieges

**Discord plafonne une categorie a 50 salons.** Au-dela, la creation
echoue. D'ou `overflow_category_id` : une seconde categorie de repli. Sans
elle, le systeme s'arrete net un jour de forte activite, et le message
d'erreur ne dit pas pourquoi.

**Le nombre de tickets par personne doit etre plafonne.** Sans
`max_tickets_per_user`, une seule personne peut ouvrir cinquante salons
en une minute.

**Le `custom_id` est plafonne a 100 caracteres**, comme pour la
pointeuse. Un depassement echoue en silence.

**Un service peut etre ferme temporairement** sans etre retire du menu :
c'est `enabled`, ou le champ `unavailable` chez nous. L'entree reste
visible mais repond « pas disponible ». Retirer l'entree fait croire que
le service n'existe pas.

**Le salon survit a la base.** Si vous supprimez une ligne
`ticket_tickets`, le salon Discord reste. Toujours fermer le ticket par
le bot, jamais en supprimant la ligne.

---

## B7. L'ordre de construction

1. Les tables `ticket_panels`, `ticket_options`, `ticket_tickets`.
2. Le panneau et son menu deroulant.
3. La creation du salon avec ses permissions - **verifier avec un compte
   sans role que le salon est bien invisible**.
4. Le message d'accueil et la mention du service.
5. La prise en charge.
6. La fermeture en deux temps, puis la reouverture.
7. Les questions et reponses, si vous les voulez.
8. Le journal, la liste noire, les membres ajoutes.

**Le point 3 est le seul qui puisse causer un vrai dommage.** Le tester
avec un compte de passage avant d'ouvrir le systeme, pas apres.

---

## B8. Comment verifier que c'est bon

1. Un compte **sans aucun role** ne voit pas le salon cree.
2. Le demandeur le voit et peut y ecrire.
3. Un membre du service concerne le voit.
4. Un membre d'un **autre** service ne le voit pas.
5. Ouvrir deux tickets d'affilee : le second est refuse si le plafond
   vaut 1.
6. Fermeture : la confirmation est bien demandee.
7. Reouverture : le demandeur retrouve l'acces.

Le cas 4 est celui qu'on oublie de tester, et c'est le seul qui expose
une conversation a qui ne devrait pas la lire.
