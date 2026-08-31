# Passer sur un VPS avec SQLite

Document de travail. Rien n'est engagé : il décrit ce que la bascule apporterait, ce qu'elle coûterait, et comment la mener sans casser ce qui tourne.

## Pourquoi y penser

L'architecture actuelle est **site statique + Worker Cloudflare + Supabase**. Elle marche, mais trois contraintes reviennent sans cesse, et toutes viennent de l'absence de serveur.

**Une page ne peut pas être protégée.** GitHub Pages sert le HTML à qui le demande. On a contourné en vidant les pages de toute donnée, mais AEGIS reste téléchargeable par n'importe qui avec un `curl`. Sur un VPS, un middleware renvoie un 403 avant d'écrire un octet.

**Pas de temps réel.** Les discussions du bureau s'interrogent toutes les trois secondes parce qu'ouvrir Supabase au navigateur démonterait le contrôle des rôles. Un serveur tient des WebSockets, et le message arrive quand il est écrit.

**Le déploiement est aveugle.** Le Worker met dix minutes et peut échouer en silence ; on l'a déjà payé sept commits durant. Un VPS redémarre en deux secondes et on lit le journal.

S'y ajoutent, gratuitement : les vrais courriels, les fichiers déposés qui ne transitent plus par la base, et des tâches planifiées sans la limite de deux crons de Cloudflare.

## Ce que ça coûte vraiment

**Environ 5 € par mois** pour un VPS à 2 vCPU et 4 Go. C'est très large pour la charge.

Le vrai coût n'est pas là. Aujourd'hui, personne n'administre rien : GitHub, Cloudflare et Supabase s'occupent des mises à jour, des sauvegardes et de la disponibilité. Sur un VPS, **c'est vous**. Les correctifs de sécurité, les sauvegardes, le certificat, le disque qui se remplit, le service qui ne redémarre pas après un reboot : plus personne derrière.

À deux personnes sur un serveur RP, c'est tenable. Mais il faut le vouloir.

## Ce qu'il y a à migrer

**22 tables** : `agents`, `grades`, `units`, `app_users`, `agent_historique`, `dossiers_disciplinaires`, `plaintes`, `plaintes_ai`, `tests_poudre`, `ftf_dossiers`, `mdt_categories`, `mdt_pages`, les cinq `liaisons_*` et les cinq `bureau_*`.

**Environ 24 600 lignes de code**, dont `worker.js` (10 900) qui contient à la fois le bot Discord et toutes les API.

Ce dernier point est le plus important : **le Worker n'est pas jetable**. Il porte les commandes Discord, la synchronisation des rôles, la pointeuse, les embeds. Sur un VPS il devient un simple fichier Node ; presque tout le code se reprend tel quel, seules les entrées et les sorties changent.

## La pile visée

| Aujourd'hui | Sur le VPS |
|---|---|
| GitHub Pages | **Next.js** sert les pages, derrière nginx |
| HTML et JS écrits à la main | **React**, en composants |
| Worker Cloudflare | Routes API de Next.js, même logique |
| Supabase Postgres | **SQLite**, un fichier |
| Supabase Auth | Discord OAuth traité par le serveur, session en cookie |
| RLS sans policy | Contrôle dans le middleware |
| Interrogation toutes les 3 s | WebSocket |

Debian 12, Node 22 LTS, **Next.js 15** en App Router, **React 19**, `better-sqlite3`, nginx en frontal, Let's Encrypt pour le certificat, systemd pour tenir le service en vie.

**Pourquoi `better-sqlite3`** : il est synchrone. Pas de promesses à enchaîner pour lire trois lignes, et sur un fichier local une lecture prend quelques microsecondes. Le code en devient nettement plus lisible que l'actuel.

## React et Next.js

C'est la partie qui change le plus, et celle dont le coût est le plus facile à sous-estimer.

### Ce que Next.js apporte

**La protection des pages, pour de bon.** Un `middleware.ts` s'exécute avant que la moindre page soit rendue. C'est exactement ce qui manque aujourd'hui :

```ts
// middleware.ts : la page n'est jamais rendue si le rôle manque.
export function middleware(req: NextRequest) {
  const session = lireSession(req.cookies);
  if (req.nextUrl.pathname.startsWith('/aegis')) {
    if (!session) return NextResponse.redirect(new URL('/connexion', req.url));
    if (!session.roles.some(r => ROLES_AEGIS.includes(r))) {
      return new NextResponse('Accès refusé', { status: 403 });
    }
  }
  return NextResponse.next();
}
```

**Les composants serveur.** Une page peut lire SQLite directement pendant son rendu, sans API intermédiaire. Le HTML arrive rempli, il n'y a pas d'écran de chargement, et les données ne transitent jamais par un point que le navigateur pourrait appeler seul.

```tsx
// app/divisions/[code]/page.tsx : ceci tourne sur le serveur, uniquement.
export default async function Division({ params }) {
  const qui = await session();
  if (!qui.divisions.includes(params.code)) notFound();
  const docs = db.prepare('SELECT * FROM bureau_documents WHERE division = ?').all(params.code);
  return <Documents liste={docs} />;
}
```

**Le reste vient avec** : le regroupement du JS, les images optimisées, le rendu du premier affichage, le typage de bout en bout si on prend TypeScript.

### Ce que React coûte

**Il faut réécrire le front. Entièrement.**

| Fichier | Lignes | Ce qu'il devient |
|---|---|---|
| `app.js` | ~8 800 | Une trentaine de composants, le gros du travail |
| `sasp/liaisons/index.html` | ~3 700 | AEGIS : le moteur du graphe reste tel quel, enveloppé |
| `index.html` (bureau) | ~1 200 | Fenêtres et barre des tâches en composants |
| `worker.js` | ~10 900 | Routes API : la logique se reprend presque telle quelle |

Environ **13 700 lignes de front à repenser**. Ce n'est pas une migration, c'est une réécriture. Comptez des mois à temps partiel, pas des semaines.

Et ce sera plus long qu'il n'y paraît, parce que le code actuel manipule le DOM directement partout : `innerHTML`, `getElementById`, des gestionnaires posés à la main. React interdit cette façon de faire ; chaque écran est à repenser en état plutôt qu'en instructions.

### Le chemin praticable

Ne pas tout réécrire d'un coup. Next.js sait servir des fichiers statiques tels quels depuis `public/` :

**1.** Monter Next.js, déposer `pa.html`, `app.js`, `style.css` et AEGIS dans `public/`. Tout fonctionne comme aujourd'hui, sans une ligne de React.

**2.** Mettre le `middleware.ts` en place. Les pages sont enfin protégées, et **on n'a encore rien réécrit**. C'est le gain le plus grand pour l'effort le plus faible.

**3.** Porter le bureau en React. C'est le plus récent, le plus petit, et celui qu'on connaît le mieux.

**4.** Porter l'intranet écran par écran. `/agents` en React pendant que `/grades` reste en `public/`, les deux cohabitent sans se gêner.

**5.** AEGIS en dernier, si jamais. Son moteur de graphe, le canvas et le SVG n'ont rien à gagner à devenir du React. Un composant qui l'enveloppe et le laisse travailler suffit.

L'étape 2 mérite qu'on s'y arrête : elle apporte à elle seule la protection réelle des pages, pour quelques heures de travail. Les étapes 3 à 5 sont du confort.

### SQLite dans Next.js, les deux pièges

**`better-sqlite3` est un module natif.** Il faut le déclarer, sinon la compilation échoue au déploiement :

```js
// next.config.js
module.exports = {
  serverExternalPackages: ['better-sqlite3'],
  output: 'standalone'   // pour ne déployer que ce qui sert
};
```

**La connexion doit survivre au rechargement à chaud.** En développement, Next.js recharge les modules à chaque sauvegarde ; sans précaution, chaque rechargement ouvre une connexion de plus et le processus finit par manquer de descripteurs :

```ts
// lib/db.ts
import Database from 'better-sqlite3';
const g = globalThis as { _db?: Database.Database };
export const db = g._db ?? (g._db = new Database('/var/sasp/sasp.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

Et la règle qui ne souffre aucune exception : **`db` ne s'importe jamais dans un composant client**. Un `'use client'` en tête de fichier et un import de la base dans le même arbre, et le bundler tente d'embarquer SQLite dans le navigateur. L'erreur est déroutante quand on ne connaît pas la cause.

## SQLite est-il assez ?

**Oui, très largement.** SQLite tient des millions de lectures par jour sur un disque correct. Le SASP SUD, c'est quelques dizaines de personnes.

Le seul point à comprendre : **un seul écrivain à la fois**. Avec le mode WAL, les lectures ne bloquent jamais et les écritures se suivent en file. À votre échelle, une écriture dure moins d'une milliseconde, la file ne se forme jamais.

```js
db.pragma('journal_mode = WAL');   // lectures et écritures en parallèle
db.pragma('synchronous = NORMAL'); // rapide, sûr avec le WAL
db.pragma('foreign_keys = ON');    // SQLite les ignore sinon, silencieusement
```

Ce dernier `pragma` mérite qu'on s'y arrête : **SQLite désactive les clés étrangères par défaut**. Sans cette ligne, `ON DELETE CASCADE` ne fait rien du tout, et personne ne s'en aperçoit avant que des lignes orphelines s'accumulent.

## Traduire le schéma

Les types Postgres n'existent pas tous. Le tableau des correspondances :

| Postgres | SQLite | Ce qui change |
|---|---|---|
| `BIGSERIAL` / `SERIAL` (19 usages) | `INTEGER PRIMARY KEY AUTOINCREMENT` | Doit être la clé primaire, pas juste une colonne |
| `TIMESTAMPTZ` (25) | `TEXT` en ISO 8601 UTC | Écrire `new Date().toISOString()`, jamais l'heure locale |
| `JSONB` (5) | `TEXT` | `JSON.stringify` en écriture, `JSON.parse` en lecture |
| `TEXT[]` (3) | `TEXT` contenant un tableau JSON | Les requêtes de contenance changent, voir plus bas |
| `UUID` + `uuid_generate_v4()` (14) | `TEXT` + `crypto.randomUUID()` | La valeur par défaut se met dans le code, pas dans le schéma |
| `BOOLEAN` (9) | `INTEGER` 0 ou 1 | `!!valeur` en lecture, sinon `0` passe pour vrai en JS |

**Le piège des tableaux.** `bureau_mails.destinataires` est un `TEXT[]` interrogé par contenance :

```sql
-- Postgres, aujourd'hui
destinataires=ov.{"leoarras@sasp.com","swat@sasp.com"}
```

SQLite n'a pas de type tableau. Deux options, et la deuxième est la bonne :

```sql
-- Bricolage : marche, mais aucune indexation possible
SELECT * FROM bureau_mails WHERE destinataires LIKE '%"leoarras@sasp.com"%';

-- Propre : une table de liaison, indexée
CREATE TABLE bureau_mail_dest (
  mail_id  INTEGER NOT NULL REFERENCES bureau_mails(id) ON DELETE CASCADE,
  adresse  TEXT NOT NULL,
  PRIMARY KEY (mail_id, adresse)
);
CREATE INDEX idx_dest ON bureau_mail_dest (adresse);
```

Le `LIKE` fonctionnerait sur cent mails et s'effondrerait sur dix mille. Autant faire les choses correctement pendant qu'on y est : c'est le bon moment, la migration réécrit de toute façon les insertions.

Même raisonnement pour `lu_par`.

## L'authentification, ce qui change vraiment

C'est le gain le plus net, et le seul endroit où le code change en profondeur.

**Aujourd'hui** : le navigateur détient un jeton Supabase, l'envoie à chaque appel, le Worker le valide auprès de Supabase puis relit les rôles Discord. Trois allers-retours pour savoir qui parle.

**Sur le VPS** : le serveur mène lui-même l'échange OAuth avec Discord, pose un cookie `httpOnly`, et garde la session. Les rôles se lisent une fois puis se rafraîchissent en tâche de fond.

```js
// Ce qu'on ne pouvait pas écrire jusqu'ici : refuser AVANT de servir la page.
app.get('/sasp/liaisons', exigeRole(['command_staff', 'lead_cid']), (req, res) => {
  res.sendFile('liaisons.html');
});
```

Cette seule ligne rend caduc tout le compromis « coquille publique, données verrouillées » qu'on a dû construire. La page elle-même devient inaccessible.

**Le cookie doit être `httpOnly`, `secure` et `sameSite: 'lax'`.** Sans `httpOnly`, un script injecté lit la session ; c'est précisément ce contre quoi on se protège en quittant le jeton côté navigateur.

## Les sauvegardes, le vrai risque

Toute la base est **un seul fichier**. C'est sa force et son danger : un `rm` malheureux, un disque qui lâche, et tout est perdu.

**Ne jamais copier le fichier pendant qu'on écrit dedans** : on obtient une base corrompue sans le savoir. SQLite fournit l'outil qui fait ça proprement :

```bash
sqlite3 /var/sasp/sasp.db ".backup '/var/sauvegardes/sasp-$(date +%F-%H%M).db'"
```

Toutes les heures par cron, une copie quotidienne envoyée **hors du VPS** (un autre serveur, un stockage objet, n'importe où sauf la même machine), et trente jours d'historique. Une sauvegarde qui vit à côté de ce qu'elle protège ne protège de rien.

**Tester une restauration** avant d'en avoir besoin. Une sauvegarde jamais restaurée n'est pas une sauvegarde, c'est une intention.

## Le déroulé de la bascule

**1. Monter le VPS à côté.** Rien n'est coupé. Debian, Node, nginx, un sous-domaine provisoire.

**2. Traduire le schéma** selon le tableau ci-dessus, et créer la base vide.

**3. Écrire le script de reprise.** Il lit Supabase avec la clé service et remplit SQLite. À écrire une fois, à rejouer autant qu'on veut :

```js
// Une transaction par table : soit tout passe, soit rien.
const inserer = db.transaction(lignes => {
  for (const l of lignes) stmt.run(l);
});
```

**4. Porter le serveur.** Le Worker devient des routes API de Next.js. Elles gardent leurs chemins `/api/...`, donc le front n'a rien à changer. La partie Discord se reprend telle quelle, dans un processus à part ou dans le même.

**5. Déposer le front actuel dans `public/`.** Sans une ligne de React. Le site tourne alors entièrement sur le VPS, à l'identique.

**6. Poser le `middleware.ts`.** Les pages deviennent réellement protégées. C'est ici que se gagne l'essentiel.

**7. Faire tourner les deux en parallèle une semaine.** L'ancien reste la référence, le nouveau se remplit et se compare. C'est là qu'on trouve les écarts.

**8. Basculer le DNS.** Et garder l'ancien joignable un mois, au cas où.

Ne pas viser la bascule en un week-end. Compter **deux à trois semaines à temps partiel** pour aller jusqu'à l'étape 8, dont l'essentiel sur la 4.

**La réécriture en React vient après, et seulement si vous la voulez.** Elle n'est pas nécessaire pour gagner la protection des pages, le temps réel ni les courriels : tout cela est acquis à l'étape 6. React apporte du confort de développement et un code plus tenable à long terme, pas une fonctionnalité de plus.

## Ce que ça enlève

Il faut le dire aussi, sinon la décision est faussée.

**Le déploiement devient manuel, et il y a une compilation.** Aujourd'hui un `git push` suffit et le fichier est en ligne. Demain il faudra tirer, lancer `npm run build`, redémarrer le service, vérifier. La compilation prend une à deux minutes et **peut échouer** : une erreur de type, un import de la base dans un composant client, et rien ne part. Ça se scripte, mais c'est une étape de plus entre vous et la mise en ligne.

**Il faut connaître React.** Le code actuel se lit avec du HTML et du JavaScript. Après la réécriture, il faudra comprendre les composants, l'état, les effets, la frontière entre serveur et client. Si l'un de vous deux ne connaît pas, il perd l'accès à une partie du code jusqu'à l'apprendre.

**Plus de CDN.** GitHub Pages sert la page depuis le point le plus proche du visiteur. Un VPS unique sert depuis un seul endroit.

**Plus d'interface Supabase.** L'éditeur SQL en ligne, la vue des tables, les journaux : tout ça disparaît. `sqlite3` en ligne de commande, ou un outil comme DB Browser en local sur une copie.

**Une machine à surveiller.** Si elle tombe à trois heures du matin, personne ne la relève à votre place.

## Verdict

**Si vous voulez la protection réelle des pages, le temps réel et les vrais courriels, le VPS est la seule voie.** Ces trois choses sont impossibles là où on est, quoi qu'on fasse.

**Si l'architecture actuelle vous convient, n'y touchez pas.** Elle est plus sûre par construction : rien à administrer, rien à sauvegarder, rien qui tombe la nuit.

Une voie moyenne existe, souvent la plus raisonnable : **garder GitHub Pages pour le front, mettre un petit serveur Node sur le VPS pour l'API et le bot**. On gagne le temps réel, les fichiers et les courriels, sans reprendre l'hébergement du site ni perdre le CDN. La protection des pages reste hors de portée, mais c'est la contrainte la moins gênante des trois.

**Sur React et Next.js, séparez bien les deux décisions.** Next.js sur le VPS vaut le coup dès l'étape 6 : quelques heures de travail, et les pages sont protégées pour de bon. La réécriture du front en React est une décision distincte, qui n'apporte aucune fonctionnalité et coûte des mois. Prenez la première maintenant si vous basculez, gardez la seconde pour quand le code actuel vous gênera vraiment.
