# Installer le poste SASP sur le VPS

Suite pratique de `vps.md`. Ici, seulement des commandes a coller, dans
l'ordre. Le principe est celui de l'etape 5 du document : **on deplace ce
qui existe, sans rien reecrire**. La reprise en React et le passage a
SQLite viennent apres, et seulement si vous les voulez.

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

La suite suppose Debian 12 ou Ubuntu 22/24. Si c'est autre chose,
dites-le-moi avant de continuer.

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

Dans la session root :

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh
```

`sshd -t` verifie le fichier avant de redemarrer : sans lui, une faute de
frappe coupe SSH pour de bon.

### 1.7 Pare-feu et anti-force brute

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
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version        # doit afficher v22.x
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

Ouvrez Cloudflare, `Workers & Pages` > `sasp-intranet-bot` > `Settings` >
`Variables and Secrets`. Les valeurs des secrets n'y sont plus lisibles :
il faut les reprendre a la source (portail developpeur Discord pour le
token et la cle publique, tableau de bord Supabase pour la cle service).

```bash
sudo cp /opt/sasp/vps/api.env.exemple /etc/sasp/api.env
sudo nano /etc/sasp/api.env
sudo chmod 600 /etc/sasp/api.env
sudo chown root:root /etc/sasp/api.env
```

Les `[vars]` de `wrangler.toml` y sont deja pre-remplies : seuls les
secrets du haut sont a completer.

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

Dans `/etc/nginx/sites-available/sasp`, remplacez les deux blocs du haut
par les deux blocs commentes du bas, en mettant votre nom a la place de
`EXEMPLE.fr`. Puis :

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sasp.EXEMPLE.fr -d api.sasp.EXEMPLE.fr
```

Certbot ajoute lui-meme l'ecoute en 443 et renouvelle tout seul.

Refaites pointer le site sur l'adresse en HTTPS :

```bash
API_URL=https://api.sasp.EXEMPLE.fr /opt/sasp/vps/mettre-a-jour.sh
```

### 5.3 Supabase

Tableau de bord Supabase > `Authentication` > `URL Configuration` :

- `Site URL` : `https://sasp.EXEMPLE.fr`
- `Redirect URLs` : ajoutez `https://sasp.EXEMPLE.fr/**`

**Gardez l'ancienne adresse GitHub Pages dans la liste** tant que les deux
tournent en parallele.

### 5.4 Discord

Portail developpeur > votre application > `General Information` :

- `Interactions Endpoint URL` : `https://api.sasp.EXEMPLE.fr`

Discord verifie l'adresse en envoyant un `PING` signe **au moment ou vous
enregistrez**. Si `DISCORD_PUBLIC_KEY` est absente ou fausse dans
`/etc/sasp/api.env`, il refuse. Le service doit donc tourner avant.

**Des cet enregistrement, le bot repond depuis le VPS et plus depuis
Cloudflare.** C'est le point de non-retour de la bascule : gardez le
Worker en place, il ne genera pas.

---

## Etape 6 - Refermer

Une fois que tout tient depuis quelques jours :

```bash
sudo ufw delete allow 8080/tcp
sudo systemctl reload nginx
```

Et retirez du fichier nginx le bloc d'ecoute en 8080.

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
