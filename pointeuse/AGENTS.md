# Construire une pointeuse Discord

Consigne pour un agent. A deposer a la racine du projet ou la pointeuse
doit etre construite.

**Ce qui est demande : refaire ce systeme, pas le copier.** Il n'y a
aucune donnee a reprendre, aucune base a migrer. On repart d'une base
vide sur un autre serveur Discord.

Tout ce qui suit decrit un systeme qui tourne en production depuis
plusieurs mois. Les valeurs, les structures et les pieges sont releves
dessus, pas imagines.

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
