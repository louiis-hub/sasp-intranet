# Pointeuse Discord - specification et code

De quoi reproduire la pointeuse du bot SASP SUD (`1519137798827933707`) sur
un autre serveur.

**Le code est fourni tel quel, pas decrit :** [pointeuse/pointeuse.js](pointeuse/pointeuse.js),
**1 124 lignes, 58 fonctions**, extraites verbatim de `worker.js`. Rien n'a
ete reecrit pour la documentation - c'est exactement ce qui tourne.

Le schema des tables est dans [pointeuse/schema.sql](pointeuse/schema.sql).

---

## 1. Ce que ca fait

Un **message permanent** dans un salon, avec deux boutons : prise de
service, fin de service. Il affiche qui est en service et se rafraichit
tout seul.

Le probleme qu'il resout n'est pas de compter les heures - c'est
**l'agent qui oublie de pointer sa fin de service** et laisse tourner
huit heures pour rien. Toute la mecanique de confirmation existe pour ca.

---

## 2. Le mecanisme anti-oubli

C'est le coeur, et la seule partie qu'il faut comprendre avant de la
reprendre.

```js
const SERVICE_CONFIRM_AFTER_MS        = 5 * 60 * 60 * 1000;   // 5 h
const SERVICE_CONFIRM_REPEAT_MS       = 2 * 60 * 60 * 1000;   // 2 h
const SERVICE_CONFIRM_GRACE_MS        =     15 * 60 * 1000;   // 15 min
const SERVICE_FIRST_MISSED_PENALTY_MS = 4 * 60 * 60 * 1000;   // - 4 h
const SERVICE_CONFIRMED_END_PENALTY_MS= 1 * 60 * 60 * 1000;   // - 1 h
```

**Le deroule.** Un cron passe toutes les 15 minutes sur les services
ouverts.

1. Au bout de **5 h**, il envoie un message prive avec un bouton
   « toujours en service ». Puis toutes les **2 h**.
2. L'agent a **15 minutes** pour repondre.
3. Passe ce delai, le service est **ferme d'office** - mais pas a l'heure
   reelle.

**La penalite est la ou se joue la justesse.** On retranche :

| Situation | Retenue | Raison |
|---|---|---|
| Jamais confirme | **4 h** | On ignore quand la personne est vraiment partie |
| Avait deja confirme | **1 h** | Elle etait la il y a moins de 2 h |

Cette distinction n'est pas cosmetique. Sans elle, on punit de la meme
facon celui qui a laisse tourner toute la nuit et celui qui a confirme de
bonne foi puis s'est deconnecte cinq minutes apres. C'est ce qui fait
accepter le systeme par les agents.

**Le dimanche a 18 h UTC**, un second cron ferme tous les services encore
ouverts (`autoClockoutAll`).

---

## 3. Le rattrapage

Une pointeuse automatique se trompe. Il faut donc une porte de sortie,
sinon les agents contestent chaque semaine.

Le message prive porte un bouton **« Reclamer des heures »**. Il ouvre un
formulaire : nombre d'heures et **motif obligatoire**. La demande part
dans un salon du Command Staff, qui a trois boutons :

- **Valider** les heures demandees
- **Saisir** un autre nombre d'heures - c'est celui qui sert le plus
- **Refuser**

La correction atterrit dans `pointeuse_corrections`, **une ligne par agent
et par semaine**, avec une contrainte d'unicite. Deux lignes se
cumuleraient sans que personne ne le voie.

**Le delai de reclamation est de 48 h** (`CLAIM_WINDOW_MS`). Au-dela, le
bouton se desactive et renvoie vers le Command Staff.

---

## 4. Comment l'agent est reconnu

**Par son identifiant Discord, jamais par son pseudo.** Un pseudo change,
un identifiant non.

`getAgentForPointeuseInteraction` essaie dans cet ordre :

1. `discord_id` dans la table des agents ;
2. a defaut, le **matricule lu dans le pseudo** du serveur - la fonction
   `parseAgentIdentityFromDiscordName` reconnait la forme `[12] Prenom Nom` ;
3. sinon, elle refuse avec un message qui dit quoi faire :
   *« Ton Discord ID n'est lie a aucun agent. Configure-le dans ton profil
   sur l'intranet. »*

Ce troisieme point compte : un refus muet fait revenir la personne vers
vous, un refus qui explique la renvoie vers la solution.

---

## 5. Les boutons et leur aiguillage

| `custom_id` | Ce qui se passe |
|---|---|
| `prise_service` | `handlePointeuseServiceButton` |
| `fin_service` | idem |
| `pointeuse_confirm_yes\|...` | `handlePointeuseConfirmationButton` |
| `pointeuse_confirm_no\|...` | idem |
| `pointeuse_claim\|site\|id` | ouvre le formulaire de reclamation |
| `pcm\|...` | le formulaire renvoye - forme courte |
| `pointeuse_claim_accept\|id` | valide les heures demandees |
| `pointeuse_claim_custom\|...` | ouvre la saisie d'un autre nombre |
| `pointeuse_claim_refuse\|...` | refuse |

**Un `custom_id` Discord ne peut pas depasser 100 caracteres.** D'ou
`pcm` au lieu de `pointeuse_claim_modal`, et les `.slice(0, 100)` partout.
En le reproduisant, gardez ce reflexe : le depassement echoue en silence
et le bouton ne fait rien.

Le routage se fait dans le gestionnaire d'interactions :

```js
// Modales
if (interaction.type === 5 && (id.startsWith("pointeuse_claim_modal|") || id.startsWith("pcm|")))
  return json(await sendPointeuseClaimToStaff(env, interaction, id));

// Boutons
if (id === "prise_service" || id === "fin_service") {
  await handlePointeuseServiceButton(env, interaction, id);
  return json({ type: 6 });                    // 6 = accuse reception differe
}
if (id.startsWith("pointeuse_confirm_yes|") || id.startsWith("pointeuse_confirm_no|"))
  return json(await handlePointeuseConfirmationButton(env, interaction, id));
```

---

## 6. Le cron

Deux declencheurs, et c'est tout.

```js
async scheduled(event, env, ctx) {
  if (event.cron === '0 18 * * SUN') {
    ctx.waitUntil(autoClockoutAll(env));           // fin de semaine
  } else {
    ctx.waitUntil(processPointeuseConfirmations(env, "sud"));
    if (env.POINTEUSE_CHANNEL_ID && env.POINTEUSE_MESSAGE_ID) {
      ctx.waitUntil(refreshPointeuseMessage(env,
        env.POINTEUSE_CHANNEL_ID, env.POINTEUSE_MESSAGE_ID, "sud").catch(() => null));
    }
  }
}
```

`*/15 * * * *` pour le premier. **Tout depend de ce cron** : s'il ne
tourne pas, aucune confirmation ne part et les services restent ouverts
sans etre penalises. C'est le point de defaillance unique du systeme, a
surveiller en priorite.

---

## 7. Ce qu'il faut fournir autour

Le module est autonome sauf pour ces cinq variables d'environnement :

```
DISCORD_BOT_TOKEN
DISCORD_APPLICATION_ID
POINTEUSE_CHANNEL_ID          le salon du message permanent
POINTEUSE_MESSAGE_ID          le message lui-meme, cree une fois a la main
POINTEUSE_CLAIM_CHANNEL_ID    ou arrivent les reclamations
```

**`POINTEUSE_CHANNEL_ID` et `POINTEUSE_MESSAGE_ID` vont par paire.** Le
message doit exister dans ce salon, sinon le rafraichissement echoue
toutes les 15 minutes, silencieusement.

Cote base, le module appelle `sbForSite(env, methode, chemin, corps)`,
qui parle a PostgREST. Si vous avez autre chose, c'est la seule fonction
a reecrire - les 17 appels qui la consomment ne bougent pas.

Les fonctions d'appui livrees dans le module :

| | |
|---|---|
| `discordFetch`, `sendUserDM`, `editMessage` | Discord |
| `sbForSite`, `sb`, `getSupabaseConfigForSite` | la base |
| `getAgentByDiscordId`, `getAgentByMatricule`, `parseAgentIdentityFromDiscordName`, `sameAgentIdentity` | retrouver la personne |
| `addMsIso`, `penalizedEndIso`, `weekInfoFromIso`, `getParisClock`, `formatDurationFromMs`, `parsePositiveHours` | les dates et durees |
| `modalValue`, `updateInteractionOriginal`, `json` | les interactions |
| `claimStaffAllowed` | qui peut valider une reclamation |

---

## 8. Les pieges

**Le double pointage.** `getActivePointagesForAgentIdentity` rend une
**liste**, pas une ligne. Deux services ouverts pour la meme personne,
c'est arrive - un clic double, ou deux identites qui se rejoignent.
`uniqueActivePointages` deduplique, et la fermeture ferme **tous** les
pointages ouverts, pas seulement le premier.

**Le fuseau.** `getParisClock` calcule l'heure de Paris avec
`Intl.DateTimeFormat`, pas avec un decalage fixe. Un `+2` en dur se
trompe la moitie de l'annee, et l'annonce du dimanche part une heure a
cote pendant six mois.

**Les crons en double.** Si vous gardez un ancien hebergement en parallele
pendant une migration, ce cron partira deux fois : doubles messages
prives, doubles fermetures. Prevoyez un interrupteur des le depart.

**Le message prive peut echouer.** Un agent qui a ferme ses DM ne recoit
rien. `sendPointeuseConfirmationRequest` leve, l'appelant attrape et
journalise - le service **n'est pas** ferme pour autant. Ne changez pas
ce comportement : fermer d'office quelqu'un qu'on n'a pas pu prevenir est
la meilleure facon de rendre le systeme deteste.

**Le `custom_id` a 100 caracteres.** Voir la section 5.

---

## 9. Le monter

1. Poser les deux tables : [pointeuse/schema.sql](pointeuse/schema.sql).
2. Copier [pointeuse/pointeuse.js](pointeuse/pointeuse.js) dans votre bot.
3. Renseigner les cinq variables d'environnement.
4. Creer **a la main** le message permanent dans le salon voulu, avec les
   deux boutons `prise_service` et `fin_service`, et noter son
   identifiant dans `POINTEUSE_MESSAGE_ID`. `buildPointeuseMessage` en
   donne le contenu exact.
5. Brancher l'aiguillage de la section 5.
6. Brancher les deux crons de la section 6.
7. Verifier que vos agents ont un `discord_id` renseigne, sinon le bouton
   les refusera tous.

**Compter une demi-journee** si votre bot a deja un acces base et un
gestionnaire d'interactions. L'essentiel du temps part dans le point 7 et
dans le reglage des cinq constantes, pas dans le code.

---

## 10. Regler les constantes pour votre serveur

Les valeurs livrees conviennent a un serveur ou les services durent 4 a
8 heures. Pour d'autres rythmes :

| Si vos services durent | Premiere confirmation | Repetition |
|---|---|---|
| 1 a 2 h | 45 min | 30 min |
| 4 a 8 h | **5 h** (livre) | **2 h** (livre) |
| Plus de 12 h | 6 h | 3 h |

**Ne descendez pas le delai de grace sous 10 minutes.** Quinze, c'est
deja court pour quelqu'un qui joue : il faut lire le message prive,
changer de fenetre et cliquer. En dessous, vous fermez des services
d'agents qui etaient bien la, et vous passez vos semaines a traiter des
reclamations.
