# SASP SUD : intranet, poste de travail et AEGIS

Serveur GTA-RP. Ce dépôt porte trois applications qui partagent une base.

**Périmètre : SASP SUD uniquement. Ne jamais toucher au SASP NORD.**

## Ce qui vit où

| Fichier | Rôle |
|---|---|
| `index.html` | Le **poste de travail**. C'est la racine du site, ce qu'on voit en arrivant. Autonome : tout son CSS et son JS sont dedans. |
| `pa.html` | L'**intranet Police Academy**. Charge `config.js`, `db.js`, `app.js`, `style.css`. Il est dans le dossier racine exprès : le déplacer casserait tous ses chemins relatifs. |
| `app.js` | ~5 500 lignes. Le cœur de l'intranet : agents, grades, pointeuse, plaintes, cartes PPA, FTF. |
| `sasp/liaisons/index.html` | **AEGIS**, l'outil d'enquête. Autonome, ~2 400 lignes. |
| `worker.js` | Le Worker Cloudflare : bot Discord et **toutes** les API. ~6 500 lignes. |
| `*.sql` | Migrations à exécuter **à la main** dans l'éditeur SQL de Supabase. Aucune n'est jouée automatiquement. |

## Architecture, et ce qu'elle interdit

Site **statique** sur GitHub Pages + **Worker Cloudflare** + **Supabase**. Il n'y a ni serveur de rendu, ni session côté serveur, ni middleware.

Conséquence à ne jamais oublier : **une page ne peut pas être protégée**. GitHub Pages sert le HTML à qui le demande. La protection porte uniquement sur les **données** : les pages sont des coquilles vides, tout vient de l'API.

Le Worker valide le jeton Supabase auprès de `/auth/v1/user`, en tire l'identifiant Discord, puis **relit les rôles Discord à chaque requête**. Un rôle retiré ferme l'accès dans la seconde.

Les tables sensibles (`liaisons_*`, `bureau_*`) ont **RLS activé sans aucune policy** : rien n'est lisible depuis le navigateur, même avec la clé anon. **Ne jamais ajouter de policy `authenticated` dessus** : cela contournerait toute la vérification de rôles d'un coup.

## Les pièges qui ont déjà coûté cher

**Le déploiement est la production.** Un push sur `gh-pages` met le site et le Worker en ligne. Il n'y a pas de préproduction. Toujours `git pull --rebase origin gh-pages` avant de pousser.

**Vérifier la conclusion de l'action GitHub, pas seulement un HTTP 200.** Le Worker est resté figé pendant sept commits sans que rien ne le signale : j'avais ajouté deux crons, dépassé la limite de Cloudflare, et l'action échouait en silence pendant que le site, lui, se mettait à jour. `wrangler.toml` ne doit pas dépasser **deux crons**.

**Le préflight CORS est global.** `worker.js` a un gestionnaire `OPTIONS` tout en haut de `fetch()` qui répond à *tous* les préflights avant qu'aucune route ne soit atteinte. Un bloc `OPTIONS` dans une route est mort-né. Tout nouvel en-tête de requête doit être déclaré dans ce gestionnaire global. Vérifier un préflight en regardant le code 204 ne prouve rien : il faut lire `access-control-allow-headers`.

**Les fins de ligne.** Tous les gros fichiers sont en CRLF. L'outil Edit et `sed -i` les écrasent en LF et produisent un diff de plusieurs milliers de lignes pour un changement d'une ligne. Pour les modifications par motif, écrire un petit script Node qui remplace en joignant avec `\r?\n` et réécrit avec la fin de ligne d'origine.

**`String.replace` mange les `$$`.** Dans le texte de remplacement, `$$` vaut un `$` littéral, `$&` la correspondance, `` $` `` ce qui précède. Un patch qui insérait `$$('#x').forEach(...)` a produit `$('#x').forEach(...)`, donc une TypeError qui coupait une fonction en plein milieu et désactivait tout ce qui suivait, sans message. Toujours passer une fonction : `s.replace(avant, () => apres)`, qui désactive ces motifs.

**L'échappement shell.** Les apostrophes françaises et les `\s` cassent `node -e '...'`. Écrire le script dans un fichier, puis l'exécuter. Un `split(/s+/)` au lieu de `/\s+/` a déjà fait échouer silencieusement toute une fonctionnalité.

**Le cache.** `index.html` et `pa.html` portent un `?v=` sur `config.js`, `db.js`, `app.js` et `style.css`. **Le changer à chaque déploiement**, sinon les navigateurs servent l'ancien JS et le bug rapporté n'existe déjà plus.

**Les rôles séparateurs Discord.** Les rôles nommés `------ [XXX] ------` sont décoratifs. Les avoir ne veut pas dire appartenir à la division. Ils ont servi d'identifiants de permission à quatre endroits, et sept membres de la Police Academy se sont retrouvés administrateurs du site.

## Accès

- **Intranet** : rôles Discord, voir `config.js` et `PAGES_PAR_PROFIL` dans `app.js`.
- **AEGIS** : Command Staff (`1500975725153620033`) et Lead CID (`1501526499910746132`), plus des accès nominatifs en base. La liste fait autorité dans `worker.js`, constante `LIAISONS_ROLES` : **jamais dans le front**, qui se contente de demander à l'API.
- **Poste de travail** : constante `BUREAU_DIVISIONS` dans `worker.js`.

## Conventions d'écriture

**Jamais de tiret cadratin** (U+2014) ni de demi-cadratin (U+2013). Uniquement le tiret simple du clavier, ou deux-points, parenthèses, virgules. Vaut pour le code, les commentaires, les messages de commit, l'interface et les annonces Discord.

Interface, commentaires et commits **en français**.

Les commentaires expliquent **pourquoi**, pas quoi. Un commentaire qui paraphrase la ligne suivante est du bruit.

## Avant de pousser

```bash
node --check worker.js
node --check app.js
```

Pour une page autonome, extraire son JS et le vérifier :

```bash
node -e 'const fs=require("fs");const s=fs.readFileSync("sasp/liaisons/index.html","utf8");
const d=s.lastIndexOf("<script>"),f=s.lastIndexOf("</script>");
fs.writeFileSync("/tmp/v.js",s.slice(d+8,f).replace(/\ndemarrer\(\);/,""),"utf8");'
node --check /tmp/v.js
```

Mieux : rejouer la logique modifiée dans Node contre les vraies données avant de pousser. C'est ce qui a permis de trouver que les liaisons de la saisie rapide étaient perdues en silence, et que la table des droits d'AEGIS se comportait bien dans ses onze cas.

## Secrets

Le token du bot Discord et la clé service Supabase sont **uniquement dans Cloudflare**, jamais dans le dépôt. Le déploiement du Worker passe par l'action GitHub et son secret.

`config.js` ne contient que la clé **anon**, publique par nature. `SASPlogs2026!` (le `LOG_TOKEN`) est lisible dans `app.js` et `worker.js` : c'est assumé, seules les personnes qui gèrent les agents ont accès au site.
