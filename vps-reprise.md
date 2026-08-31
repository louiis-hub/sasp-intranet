# Reprise du chantier VPS - brief

A coller a un agent qui reprend le travail. Il a PowerShell sur le PC de
Louis, donc SSH vers le VPS.

---

## Le projet

**SASP SUD**, intranet de serveur GTA-RP. Trois applications qui
partagent une base : le poste de travail (`index.html`), l'intranet
Police Academy (`pa.html`), l'outil d'enquete AEGIS
(`sasp/liaisons/index.html`), plus `worker.js` qui porte le bot Discord
et **toutes** les API.

Depot : `c:\Users\louis\Documents\Codex\2026-08-16\on-reprend-le-projet-bot-site\work\sasp-intranet`
Branche : `gh-pages`. Lire `AGENTS.md` puis `CLAUDE.md` **avant de
toucher au code**.

**Perimetre : SASP SUD uniquement. Ne jamais toucher au SASP NORD.**

## L'objectif

Tout deplacer de GitHub Pages + Cloudflare Workers vers le VPS. Decide le
31 aout 2026. Consigne de Louis : **copier-coller, pas de reecriture.**

Le runbook complet est `vps-installation.md`, dans le depot. Il fait
autorite : suivre ses etapes, et le corriger quand la realite le dement.

**Ce qui rend le copier-coller possible :** `worker.js` n'utilise aucune
interface propre a Cloudflare - ni KV, ni D1, ni le cache, seulement
`fetch`, `Request`, `Response` et `crypto.subtle`. Il tourne tel quel
derriere `vps/serveur.js`, un adaptateur de cent lignes deja ecrit et
essaye.

## L'acces

```powershell
ssh sasp@193.38.250.69
```

Cle `~/.ssh/id_ed25519`, deja installee, **pas de mot de passe**. Root
est desactive, les mots de passe SSH aussi.

`sudo` ne demande pas de mot de passe : `/etc/sudoers.d/sasp` porte
`NOPASSWD`, pose le 31 aout 2026 pour qu'un shell non interactif puisse
travailler. Verifiable par `ssh sasp@193.38.250.69 "sudo -n true && echo ok"`.

Le choix se tient parce que root SSH est coupe et les mots de passe SSH
aussi : la cle est deja le seul facteur.

**Tu peux donc tout faire toi-meme, sans rien faire passer par Louis.**
Raison de plus pour lire deux fois avant d'ecrire : plus rien ne s'oppose
a une commande privilegiee.

## Ou en est le chantier

| Etape | Etat | Preuve |
|---|---|---|
| 1 - Durcissement SSH | **fait** | `sshd -T` rend `permitrootlogin no`, `passwordauthentication no`. ufw actif sur 22/80/443/8080, fail2ban en marche |
| 2 - Node et nginx | **fait** | Node 22.23.2, `function object function` |
| 3 - Le site sur le VPS | **fait** | `http://193.38.250.69` affiche le poste de travail |
| 4 - L'API et le bot | **inconnu** | verifier, voir ci-dessous |
| 5 - Domaine, certificat, Discord | **bloque** | pas de nom de domaine |
| 6 - Supprimer Cloudflare | a faire | depend de la 5 |
| 7 - Sortir de Supabase | plus tard | decision de Louis : apres la 6, pas avant |

**Commence par ca**, ca leve tous les doutes d'un coup :

```bash
echo "-- api     : $(systemctl is-active sasp-api 2>/dev/null || echo absent)"
echo "-- env     : $(sudo test -f /etc/sasp/api.env && echo present || echo absent)"
echo "-- worker  : $(test -f /opt/sasp/vps/worker.js && echo copie || echo absent)"
echo "-- health  : $(curl -s -m 3 http://127.0.0.1:8787/health || echo 'pas de reponse')"
echo "-- nginx   : $(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health)"
echo "-- depot   : $(cd /opt/sasp && git log --oneline -1)"
```

## Ce qui reste ouvert

**Le nom de domaine.** Louis ne l'a pas encore. C'est le seul obstacle
entre lui et la sortie de Cloudflare : Discord refuse une adresse
d'interactions qui n'est pas en HTTPS, et un certificat suppose un nom.
Rien au-dela de l'etape 4 ne peut avancer sans lui.

**La connexion Discord depuis le VPS** rebondit sur GitHub Pages.
Supabase a bien les quatre entrees, il manque `http://193.38.250.69/`
avec la barre finale - c'est la forme exacte que `location.href` produit.
Sans importance : le probleme disparait avec le domaine. **Ne pas s'y
acharner.**

## Ce qui a deja mordu, et qui remordra

Ces points sont dans `CLAUDE.md` ou ont ete trouves pendant la bascule.
Les lire vaut mieux que les redecouvrir.

**Les fins de ligne.** Tous les gros fichiers du site sont en CRLF.
Ecrire avec Node en LF produit un diff de milliers de lignes pour un
changement d'une ligne. Decouper sur `/\r?\n/`, rejoindre avec la fin de
ligne d'origine. Le dossier `vps/` est en LF force par `.gitattributes` :
un script shell en CRLF donne `bad interpreter: /bin/bash^M`.

**`String.replace` mange les `$$`.** Dans le texte de remplacement, `$$`
vaut `$`, `$&` la correspondance. Toujours passer une fonction :
`s.replace(avant, () => apres)`. Un patch a deja casse trois lignes de
JavaScript en silence a cause de ca.

**Le cache.** `index.html` et `pa.html` portent un `?v=` sur `config.js`,
`db.js`, `app.js` et `style.css`. **Le changer a chaque deploiement**,
sinon le navigateur sert l'ancien code et le bug rapporte n'existe deja
plus. Les deux fichiers ont chacun leur propre valeur.

**Le token du bot Discord ne se reaffiche jamais.** Le portail ne propose
que `Reset Token`, et une regeneration **coupe net le Worker Cloudflare**
qui tourne encore. Reprendre celui que Louis a deja.

**Treize adresses `louiis-hub.github.io` en dur** dans `worker.js`,
`app.js` et `ticketing-advanced.js`. Ce sont les images que Discord va
chercher pour ses embeds. Elles disparaitront **sans aucun message** le
jour ou GitHub Pages s'arrete. La commande qui les deplace est a l'etape
5.3 du runbook.

**Verifier la conclusion, pas le code HTTP.** Un preflight qui rend 204
ne prouve rien : il faut lire `access-control-allow-headers`. De meme,
`sshd -T` dit ce que sshd applique, le fichier ne dit que ce qu'il
raconte. Cette regle a deja coute sept commits sur ce projet, ou l'action
GitHub echouait en silence.

**L'echappement shell.** Les apostrophes francaises et les `\s` cassent
`node -e '...'`. Ecrire le script dans un fichier, puis l'executer. Et
sous Git Bash sur Windows, `grep -c $'\r'` donne des faux positifs :
compter les octets avec Node.

## La methode attendue

`AGENTS.md`, a la racine du depot, la decrit en entier. L'essentiel :

**Verifier la conclusion, jamais l'apparence.** Un preflight qui rend 204
ne prouve rien, il faut lire `access-control-allow-headers`. Un push
reussi ne prouve pas que le deploiement a marche, il faut lire la
conclusion de l'action GitHub. Un fichier de configuration ne dit pas ce
que le service applique : `sshd -T`, `nginx -t`, `systemctl status`.

**Prouver avant d'affirmer.** Ne pas ecrire qu'une chose fonctionne sans
l'avoir vue fonctionner. Si un essai n'a pas ete fait, le dire.

**Avant tout push** : `node --check worker.js app.js db.js`, plus le
controle des tiret cadratins. Les commandes exactes sont dans
`AGENTS.md`.

**Modifier par script**, jamais a la main sur les gros fichiers : ils
sont en CRLF et les outils d'edition les ecrasent en LF.

## Les conventions

**Jamais de tiret cadratin** (U+2014) ni de demi-cadratin (U+2013).
Uniquement le tiret simple du clavier. Vaut pour le code, les
commentaires, les messages de commit, l'interface et Discord. Louis y
tient explicitement.

Interface, commentaires et commits **en francais**. Les commentaires
expliquent **pourquoi**, pas quoi.

**Le deploiement est la production.** Un push sur `gh-pages` met le site
et le Worker en ligne. Toujours `git pull --rebase origin gh-pages`
avant. Verifier la conclusion de l'action GitHub, pas seulement un 200.

**Demander avant toute modification importante.** Consigne de Louis.

## Les fichiers a lire

| Fichier | Ce qu'il contient |
|---|---|
| `CLAUDE.md` | architecture, pieges, conventions |
| `vps-installation.md` | le runbook, etape par etape |
| `vps.md` | le raisonnement : pourquoi, ce que ca coute, SQLite |
| `vps/serveur.js` | l'adaptateur Node, deja essaye |
| `vps/nginx-sasp.conf` | la configuration nginx, avec les blocs domaine en commentaire |
| `vps/mettre-a-jour.sh` | pull, copie du worker, rsync, redemarrage |
| `vps/api.env.exemple` | le modele de `/etc/sasp/api.env` |

## La prochaine action

1. Passer le bloc de diagnostic ci-dessus.
2. Si l'etape 4 n'est pas faite, la terminer : `/etc/sasp/api.env` puis
   le service systemd. Section 4 du runbook.
3. Aider Louis a prendre un nom de domaine, puis enchainer les etapes 5
   et 6. C'est la que Cloudflare disparait.

Ne pas commencer l'etape 7 (SQLite) : Louis a explicitement choisi de la
faire **apres** que le VPS ait tourne quelques jours.
