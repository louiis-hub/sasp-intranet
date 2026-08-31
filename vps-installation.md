# Installer le poste SASP sur le VPS

Suite pratique de `vps.md`. Ici, seulement des commandes a coller, dans
l'ordre.

**Le but : plus rien sur Cloudflare.** A la fin de l'etape 6, le site,
l'API, le bot Discord et les crons tournent tous sur le VPS, le Worker
est supprime et l'action GitHub qui le deployait aussi.

**Le principe : on deplace, on ne reecrit pas.** `worker.js` n'utilise
aucune interface propre a Cloudflare - ni KV, ni D1, ni le cache,
seulement `fetch`, `Request`, `Response` et `crypto.subtle`, que Node 22
fournit tous. Il tourne donc tel quel derriere `vps/serveur.js`, un
adaptateur d'une centaine de lignes.

Les etapes 1 a 5 se defont en remettant une adresse dans quatre fichiers.
Seule l'etape 5.5, quand Discord pointe sur le VPS, engage vraiment.

Reste ensuite **Supabase**, dernier hebergeur exterieur : c'est l'etape 7,
un chantier a part, a ne surtout pas melanger aux precedentes.

VPS : `193.38.250.69`, chez Redheberg.

---

## Avant de commencer, deux choses

### 1. Le mot de passe root est a changer

Il est passe par un courriel et il a ete colle dans une conversation. Sur
une adresse publique, le port 22 en root avec mot de passe est balaye par
des robots dans l'heure qui suit la mise en ligne. Ce n'est pas une
precaution theorique, c'est la premiere chose qui arrive. L'etape 1 s'en
occupe et **elle passe avant tout le reste**.

### 2. Il vous faut un nom de domaine

Les etapes 1 a 3 se font sans. Au-dela, deux murs :

- **Discord refuse une adresse d'interactions qui n'est pas en HTTPS.** Le
  bot ne peut donc pas quitter Cloudflare tant qu'il n'y a pas de
  certificat, et un certificat suppose un nom.
- **Supabase valide les adresses de redirection** de la connexion Discord.
  Une adresse IP nue y passe mal.

Un `.fr` coute une dizaine d'euros par an. Un sous-domaine gratuit
(DuckDNS, No-IP) fait aussi l'affaire pour commencer. Prenez-le avant
l'etape 4 ; les trois premieres n'attendent pas.

Dans la suite, remplacez `EXEMPLE.fr` par votre nom.

---

## Etape 1 - Fermer la porte

### 1.1 Une cle SSH, depuis votre PC

Dans PowerShell, **sur votre machine** :

```powershell
ssh-keygen -t ed25519 -C "louis@sasp"
```

Trois fois Entree (chemin par defaut, pas de phrase de passe si vous
preferez). Puis affichez la cle publique et gardez-la sous la main :

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

### 1.2 Premiere connexion

```powershell
ssh root@193.38.250.69
```

Une fois dedans, regardez sur quoi vous etes :

```bash
cat /etc/os-release
```

Sur ce VPS : **Debian 13 (Trixie), image cloud**. La suite en tient
compte, notamment a l'etape 1.6.

### 1.3 Changer le mot de passe root

```bash
passwd
```

### 1.4 Un compte de travail

```bash
adduser sasp
usermod -aG sudo sasp
mkdir -p /home/sasp/.ssh
chmod 700 /home/sasp/.ssh
nano /home/sasp/.ssh/authorized_keys
```

Collez la cle publique de l'etape 1.1, une seule ligne. `Ctrl+O`, Entree,
`Ctrl+X`. Puis :

```bash
chmod 600 /home/sasp/.ssh/authorized_keys
chown -R sasp:sasp /home/sasp/.ssh
```

### 1.5 Verifier AVANT de fermer quoi que ce soit

**Gardez la session root ouverte.** Ouvrez une **deuxieme** fenetre
PowerShell :

```powershell
ssh sasp@193.38.250.69
```

Si ca entre sans mot de passe, continuez. Sinon, ne touchez a rien de plus
et reprenez l'etape 1.4 : couper l'acces root avant d'avoir verifie
l'autre, c'est se fermer dehors.

### 1.6 Couper root et les mots de passe

**Le piege des images cloud.** `/etc/ssh/sshd_config` commence par
`Include /etc/ssh/sshd_config.d/*.conf`, et cloud-init y depose souvent
un `50-cloud-init.conf` qui remet `PasswordAuthentication yes`. Modifier
le fichier principal ne sert alors a rien : il est lu apres.

Pire, entre deux fichiers inclus, **c'est le premier qui l'emporte**, pas
le dernier. Un `99-...` perdrait contre le `50-` de cloud-init. D'ou le
`00-` ci-dessous.

Regardez d'abord ce qui existe :

```bash
ls -l /etc/ssh/sshd_config.d/
grep -rn "PasswordAuthentication\|PermitRootLogin" \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null
```

Puis posez le reglage dans un fichier a part, plutot que de trafiquer
celui de la distribution :

```bash
cat > /etc/ssh/sshd_config.d/00-sasp.conf <<'FIN'
# Cle uniquement, pas de root. Nomme 00- pour etre lu avant le fichier
# de cloud-init, qui reactive les mots de passe.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
FIN
sshd -t && systemctl restart ssh
```

`sshd -t` verifie la syntaxe avant le redemarrage : sans lui, une faute
de frappe coupe SSH pour de bon.

**Puis la seule verification qui compte.** Lire le fichier ne prouve
rien, il faut demander a sshd ce qu'il applique vraiment :

```bash
sshd -T | grep -E "^(permitrootlogin|passwordauthentication|pubkeyauthentication)"
```

Vous devez lire exactement :

```
permitrootlogin no
pubkeyauthentication yes
passwordauthentication no
```

Si `passwordauthentication` est encore a `yes`, un autre fichier gagne :
reprenez le `grep` ci-dessus pour trouver lequel.

### 1.7 Qui est deja passe

L'image affiche une connexion du 9 juillet depuis `92.184.96.169`. C'est
sans doute l'hebergeur au moment de la preparation, mais sur une machine
dont le mot de passe root a circule par courriel, un coup d'oeil ne coute
rien :

```bash
last -a | head -20
lastb -a | head -20      # les tentatives echouees
```

Beaucoup de lignes dans `lastb` depuis des adresses inconnues : c'est le
balayage habituel, et c'est justement ce que l'etape 1.6 vient de fermer.

### 1.8 Pare-feu et anti-force brute

```bash
apt update && apt install -y ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8080/tcp     # l'API pendant les essais ; a retirer a l'etape 6
ufw --force enable
systemctl enable --now fail2ban
ufw status
```

Fermez la session root. **Desormais tout se fait avec `sasp`.**

```powershell
ssh sasp@193.38.250.69
```

---

## Etape 2 - Poser la pile

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx rsync sqlite3 ca-certificates
```

**Node.** Debian 13 est recent, et le depot NodeSource ne le couvre pas
toujours. On essaie, et on retombe sur celui de Debian s'il refuse :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - \
  && sudo apt install -y nodejs \
  || sudo apt install -y nodejs
node --version
```

**Node 20 suffit**, si c'est ce que Debian installe. L'adaptateur a besoin
de `fetch`, `Request`, `Response`, `crypto.subtle` et
`Headers.getSetCookie` : tout est present depuis la 19.7. Ce qui ne
passerait pas, c'est une version 18 ou anterieure.

```bash
node -e "console.log(typeof fetch, typeof crypto.subtle, typeof new Headers().getSetCookie)"
```

Les trois doivent afficher `function object function`. Si l'un dit
`undefined`, dites-le-moi avant d'aller plus loin.

```bash
nginx -v
```

---

## Etape 3 - Le site, tel quel

```bash
sudo mkdir -p /opt/sasp /var/www/sasp /etc/sasp
sudo chown -R sasp:sasp /opt/sasp /var/www/sasp
git clone -b gh-pages https://github.com/louiis-hub/sasp-intranet.git /opt/sasp
```

Copiez les fichiers servis, sans le depot ni les migrations :

```bash
rsync -a --delete \
  --exclude '.git' --exclude 'vps' --exclude 'node_modules' \
  --exclude '*.sql' --exclude '*.md' --exclude '.github' \
  /opt/sasp/ /var/www/sasp/
```

Posez la configuration nginx :

```bash
sudo cp /opt/sasp/vps/nginx-sasp.conf /etc/nginx/sites-available/sasp
sudo ln -sf /etc/nginx/sites-available/sasp /etc/nginx/sites-enabled/sasp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**Verification.** Dans un navigateur : `http://193.38.250.69`

Le poste de travail doit s'afficher et vous demander la connexion Discord.
L'API pointe encore sur Cloudflare : c'est normal, et c'est meme le but.
**Le site tourne maintenant sur votre VPS, a l'identique.**

---

## Etape 4 - L'API et le bot

### 4.1 Reprendre les secrets

Cloudflare ne reaffiche pas ses secrets. Il faut donc les retrouver
ailleurs, et l'un des trois se recupere mal.

| Variable | Ou la prendre | Attention |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | Supabase > `Settings` > `API` > `service_role` | Se relit autant qu'on veut |
| `DISCORD_PUBLIC_KEY` | Portail Discord > votre application > `General Information` | Se relit, ce n'est pas un secret |
| `DISCORD_APPLICATION_ID` | Meme page | Se relit |
| `DISCORD_BOT_TOKEN` | **Ne pas regenerer** | Voir ci-dessous |

**Le token du bot ne s'affiche qu'une fois.** Le portail Discord ne
propose que `Reset Token`, et **une regeneration coupe immediatement le
Worker Cloudflare**, qui tourne encore : le bot cesse de repondre sur
Discord jusqu'a ce que la nouvelle valeur soit posee des deux cotes.

Reprenez donc celui que vous avez deja, dans vos notes. Si vous devez
malgre tout le regenerer, faites-le dans cet ordre, sans pause :

1. `Reset Token`, copier la nouvelle valeur ;
2. la poser dans `/etc/sasp/api.env` **et** dans Cloudflare
   (`Settings` > `Variables and Secrets`) ;
3. redemarrer les deux.

```bash
sudo cp /opt/sasp/vps/api.env.exemple /etc/sasp/api.env
sudo nano /etc/sasp/api.env
sudo chmod 600 /etc/sasp/api.env
sudo chown root:root /etc/sasp/api.env
```

Les `[vars]` de `wrangler.toml` y sont deja pre-remplies : seuls les
secrets du haut sont a completer.

**`SUPABASE_NORD_SERVICE_KEY` et `NORD_SUPABASE_SERVICE_KEY` peuvent
rester vides.** Elles ne servent qu'aux routes du SASP NORD, hors du
perimetre de ce depot.

### 4.2 Le service

```bash
cp /opt/sasp/worker.js /opt/sasp/vps/worker.js
sudo cp /opt/sasp/vps/sasp-api.service /etc/systemd/system/sasp-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now sasp-api
sudo systemctl status sasp-api --no-pager
```

### 4.3 Verifier

```bash
curl -s http://127.0.0.1:8787/health          # {"ok":true}
curl -s http://193.38.250.69:8080/health      # a travers nginx
```

Le piege connu du projet : un preflight qui renvoie 204 ne prouve rien, il
faut lire les en-tetes.

```bash
curl -s -i -X OPTIONS http://193.38.250.69:8080/api/bureau/moi \
  -H "Origin: http://193.38.250.69" \
  -H "Access-Control-Request-Headers: authorization" | head -6
```

`access-control-allow-headers` doit contenir `authorization`.

Les journaux :

```bash
journalctl -u sasp-api -f
```

### 4.4 Faire pointer le site sur la nouvelle API

```bash
chmod +x /opt/sasp/vps/mettre-a-jour.sh
/opt/sasp/vps/mettre-a-jour.sh
```

Le script reprend le depot, recopie `worker.js`, resynchronise le site et
remplace l'adresse Cloudflare par la votre **dans la copie servie
seulement** : le depot reste intact, donc un `git pull` ne se bat pas avec
la modification.

C'est ce script qu'on relance a chaque mise a jour, plus le `git push`.

**A ce stade, le site et l'API tournent tous les deux sur le VPS.** Le bot
Discord, lui, repond encore depuis Cloudflare : Discord ne connait pas
encore votre adresse. C'est l'etape suivante.

---

## Etape 5 - Le nom de domaine, le certificat, puis Discord

### 5.1 DNS

Chez votre registraire, deux enregistrements `A` vers `193.38.250.69` :

| Nom | Type | Valeur |
|---|---|---|
| `sasp` | A | `193.38.250.69` |
| `api.sasp` | A | `193.38.250.69` |

Attendez la propagation :

```bash
dig +short sasp.EXEMPLE.fr
```

### 5.2 nginx et le certificat

**Deux formes possibles, selon le nom obtenu.**

**Un seul nom** (cas d'un DuckDNS, ou d'un sous-domaine chez un tiers) :
le site et l'API le partagent, departages par le chemin. C'est possible
parce que le Worker n'ecoute que sur dix-neuf chemins racine, tous
enumeres dans le fichier, et qu'aucun ne heurte un fichier du site.
Discord, en particulier, tape sur `/interactions` et non sur `/`.

```bash
sudo cp /opt/sasp/vps/nginx-un-nom.conf /etc/nginx/sites-available/sasp
sudo sed -i 's/DOMAINE/sasp.EXEMPLE.fr/g' /etc/nginx/sites-available/sasp
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sasp.EXEMPLE.fr
```

**Deux noms** (si vous possedez le domaine) : reprendre les deux blocs
commentes en bas de `nginx-sasp.conf`, puis

```bash
sudo certbot --nginx -d sasp.EXEMPLE.fr -d api.sasp.EXEMPLE.fr
```

Certbot ajoute lui-meme l'ecoute en 443 et renouvelle tout seul.

**Puis faire pointer le site sur la nouvelle adresse.** Avec un seul nom,
l'API est au meme endroit que le site :

```bash
API_URL=https://sasp.EXEMPLE.fr /opt/sasp/vps/mettre-a-jour.sh
```

Verification, dans cet ordre :

```bash
curl -s https://sasp.EXEMPLE.fr/health                      # {"ok":true}
curl -s https://sasp.EXEMPLE.fr/ | grep -o "const API='[^']*'"
curl -s -o /dev/null -w "%{http_code}\n" https://sasp.EXEMPLE.fr/pa.html
```

Le premier prouve que l'API passe, le deuxieme que le site l'appelle au
bon endroit, le troisieme que les fichiers du site sortent toujours
malgre la regle de routage.

### 5.3 Les adresses ecrites en dur

Treize adresses `louiis-hub.github.io` restent dans le code, et elles ne
se voient pas depuis le navigateur : ce sont les **images des messages
Discord**. Le bot les donne a Discord, qui va les chercher lui-meme. Le
jour ou GitHub Pages s'arrete, les embeds perdent leurs images **sans le
moindre message d'erreur**.

Ou elles sont :

| Fichier | Ce que c'est |
|---|---|
| `worker.js` | `SITE_BASE_URL`, les cinq images DEFCON, le panneau de tickets, les deux logos, les images de service |
| `app.js` | trois images de panneaux de tickets |
| `ticketing-advanced.js` | le filigrane |

Une seule commande les deplace toutes, dans le depot cette fois (elles
partent dans Discord, pas dans la page servie) :

```bash
cd /opt/sasp
grep -rl 'louiis-hub\.github\.io/sasp-intranet' worker.js app.js ticketing-advanced.js \
  | xargs sed -i 's|https://louiis-hub\.github\.io/sasp-intranet|https://sasp.EXEMPLE.fr|g'
grep -rn 'louiis-hub\.github\.io' worker.js app.js ticketing-advanced.js   # doit ne rien rendre
git commit -am "Faire pointer les images Discord sur le VPS"
git push origin gh-pages
/opt/sasp/vps/mettre-a-jour.sh
sudo systemctl restart sasp-api
```

**A faire seulement une fois le certificat en place** : Discord ne
recupere pas une image en clair de facon fiable.

Verification : declenchez un message du bot qui porte une image (un
panneau de tickets, un DEFCON) et regardez si l'image s'affiche.

### 5.4 Supabase

Tableau de bord Supabase > `Authentication` > `URL Configuration` :

- `Site URL` : `https://sasp.EXEMPLE.fr`
- `Redirect URLs` : ajoutez `https://sasp.EXEMPLE.fr/**`

**Gardez l'ancienne adresse GitHub Pages dans la liste** tant que les deux
tournent en parallele.

### 5.5 Discord

Portail developpeur > votre application > `General Information` :

- `Interactions Endpoint URL` : `https://api.sasp.EXEMPLE.fr`

Discord verifie l'adresse en envoyant un `PING` signe **au moment ou vous
enregistrez**. Si `DISCORD_PUBLIC_KEY` est absente ou fausse dans
`/etc/sasp/api.env`, il refuse. Le service doit donc tourner avant.

**Des cet enregistrement, le bot repond depuis le VPS et plus depuis
Cloudflare.** C'est le point de non-retour de la bascule : gardez le
Worker en place, il ne genera pas.

---

## Etape 6 - Eteindre Cloudflare

C'est le but de l'operation. A partir d'ici plus rien n'y tourne.

### 6.1 Verifier que le VPS a bien tout repris

Avant de couper, trois preuves, pas une de moins :

```bash
# 1. Le site vient du VPS et appelle le VPS
curl -s https://sasp.EXEMPLE.fr/ | grep -o "const API='[^']*'"

# 2. L'API du VPS repond
curl -s https://api.sasp.EXEMPLE.fr/health

# 3. Le Worker Cloudflare ne recoit plus rien
```

Pour le troisieme point : Cloudflare > `Workers & Pages` >
`sasp-intranet-bot` > `Metrics`. Si la courbe des requetes est plate
depuis 24 h, plus personne ne lui parle. **Si elle ne l'est pas, quelque
chose pointe encore dessus** : cherchez avant de couper.

```bash
grep -rn "workers.dev" /var/www/sasp | head
```

Cette commande doit ne rien rendre.

Essayez aussi une commande du bot sur Discord, et une connexion complete
au site depuis une fenetre privee.

### 6.2 Couper le deploiement automatique

Sans ca, le prochain `git push` relance une action qui deploiera dans le
vide et echouera en silence - le piege qui a deja coute sept commits sur
ce projet.

```bash
cd /opt/sasp
git rm .github/workflows/deploy-worker.yml
git commit -m "Retirer le deploiement Cloudflare, le Worker vit sur le VPS"
git push origin gh-pages
```

### 6.3 Rallumer les crons du VPS

Pendant toute la bascule, `CRONS=0` a garde le VPS silencieux : le Worker
portait seul les taches periodiques. Maintenant qu'il ne recoit plus rien,
c'est au VPS de les prendre.

```bash
sudo sed -i 's/^CRONS=.*/CRONS=1/' /etc/sasp/api.env
sudo systemctl restart sasp-api
journalctl -u sasp-api -n 5 --no-pager | grep crons
```

Vous devez lire `crons : ACTIFS`. Si vous lisez encore `en veille`, la
pointeuse ne se rafraichira plus et **rien ne le signalera**.

Verification a la premiere heure ronde : le message de la pointeuse doit
se mettre a jour, et `journalctl -u sasp-api -f` afficher
`[cron] */15 * * * * termine`.

### 6.4 Supprimer le Worker

Cloudflare > `Workers & Pages` > `sasp-intranet-bot` > `Settings` >
`Delete`.

**Attendez une semaine avant de faire ce dernier geste.** Tant que le
Worker existe et ne recoit rien, il ne coute rien et il constitue le
retour en arriere le plus simple qui soit : remettre son adresse dans
Discord et dans les quatre fichiers du front, et tout revient.

### 6.5 GitHub Pages

Le depot `gh-pages` reste la source du code : c'est de la que le VPS tire
ses mises a jour. Ce qui s'arrete, c'est qu'il **serve** le site.

GitHub > `Settings` > `Pages` > `Source` : `None`.

La aussi, attendez d'etre sur. Une adresse `github.io` qui continue de
servir une vieille version pendant que le vrai site est ailleurs, c'est
une source de confusion, pas un filet.

### 6.6 Refermer le port d'essai

```bash
sudo ufw delete allow 8080/tcp
```

Et retirez du fichier nginx le bloc d'ecoute en 8080.

---

## Ou en est-on, une fois la 6 passee

| Ce qui tournait ou | Maintenant |
|---|---|
| Site sur GitHub Pages | **VPS**, nginx |
| API et bot sur Cloudflare Workers | **VPS**, systemd |
| Crons Cloudflare (2 max) | **VPS**, sans limite de nombre |
| Base Supabase | **Supabase**, toujours |
| Connexion Discord via Supabase Auth | **Supabase**, toujours |

Deux lignes restent. Elles sont le sujet de l'etape 7.

**Ce qui disparait avec Cloudflare :** la limite de deux crons, le
deploiement qui echoue sans le dire, l'impossibilite de lire un journal
au-dela de quelques minutes, et le fait qu'un `git push` soit la
production sans preproduction possible.

---

## Etape 7 - Sortir de Supabase

C'est le dernier hebergeur exterieur, et c'est un autre chantier. Voici
ce qu'il represente exactement, mesure sur le code, pas estime.

**117 appels** a la base (`sb` 67, `sbForSite` 50), a travers **20
tables**. Mais la surface reellement utilisee de PostgREST est etroite :

| Construction | Occurrences |
|---|---|
| `eq.` | 77 |
| `select=` | 58 |
| `limit=` | 50 |
| `order=` | 27 |
| `on_conflict` | 7 |
| `is.` | 6 |
| `not.` | 4 |
| `neq.` | 4 |
| `in.`, `gt.`, `ov.` | 1 chacun |
| `or=(`, `and=(`, `rpc/`, `offset=`, `range=` | **aucun** |

Et seulement **deux formes de jointure**, toutes deux a un seul niveau :
`agents(...)` depuis `pointages`, et `referent:referent_id(...)` depuis
`agents`.

**La consequence est importante :** il n'y a pas besoin de toucher aux
117 appels. Il suffit de reecrire `sb()` pour qu'il traduise cette
poignee de constructions en SQL sur SQLite. Le reste de `worker.js` ne
change pas d'une ligne, exactement comme pour la bascule ci-dessus.

Restent alors trois choses a ecrire :

1. **Le schema**, 20 tables traduites selon le tableau de `vps.md`.
2. **Le script de reprise**, qui lit Supabase avec la cle service et
   remplit SQLite, rejouable autant de fois qu'on veut.
3. **L'authentification.** C'est le seul endroit qui change vraiment :
   le serveur mene lui-meme l'echange OAuth avec Discord et pose un
   cookie, au lieu de valider un jeton Supabase. Voir la section
   correspondante de `vps.md`.

**Et c'est seulement la qu'on gagne la protection des pages.** Tant que
la connexion passe par Supabase, `sasp/liaisons/` reste telechargeable
par n'importe qui.

**A ne pas melanger avec les etapes 1 a 6.** Si le deplacement et le
changement de base se font en meme temps, la premiere panne devient
impossible a attribuer. Faites tourner le VPS quelques jours d'abord.

---

## Les sauvegardes

Tant que Supabase reste la base, il fait deja les siennes. Ce qu'il faut
sauver sur le VPS, c'est `/etc/sasp/api.env`, hors de la machine.

Quand on passera a SQLite (etape 7 de `vps.md`), la regle du document
s'applique : jamais de `cp` sur une base ouverte, toujours `.backup`, et
une copie **ailleurs**.

```bash
sqlite3 /var/sasp/sasp.db ".backup '/var/sauvegardes/sasp-$(date +%F-%H%M).db'"
```

---

## Depannage

| Symptome | Ou regarder |
|---|---|
| Le site s'affiche, l'API repond 502 | `journalctl -u sasp-api -n 50` : le service est probablement tombe au demarrage, souvent une variable manquante |
| `nginx -t` refuse | La ligne exacte est dans le message ; le fichier n'est pas recharge tant qu'il refuse |
| Discord refuse l'adresse d'interactions | `DISCORD_PUBLIC_KEY` absente ou fausse, ou le service arrete |
| La connexion Discord tourne en rond | L'adresse de redirection n'est pas dans la liste Supabase |
| Le navigateur sert l'ancien JS | Le `?v=` de `index.html` n'a pas change, ou nginx met `index.html` en cache |
| Plus d'acces SSH | La console de secours de Redheberg, depuis l'espace client |

---

## Ce qui reste apres

Le site, l'API et le bot tournent sur le VPS, avec le meme code. Restent
les deux gains que `vps.md` decrit et qui demandent, eux, du travail :

1. **Proteger les pages.** Aujourd'hui encore, `sasp/liaisons/` se
   telecharge par n'importe qui : seules les donnees sont fermees. Un
   serveur peut enfin refuser la page elle-meme.
2. **Passer a SQLite.** 22 tables a traduire et un script de reprise a
   ecrire. C'est ce qui supprime la dependance a Supabase.

Aucune des deux n'est urgente. La bascule ci-dessus, elle, ne casse rien
et se defait en remettant une adresse dans quatre fichiers.
