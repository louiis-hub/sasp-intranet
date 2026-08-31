#!/bin/bash
# Met le VPS a jour depuis le depot. A lancer en tant qu'utilisateur sasp.
set -euo pipefail

DEPOT=/opt/sasp
SITE=/var/www/sasp
API=${API_URL:-http://193.38.250.69:8080}

echo "== depot =="
cd "$DEPOT"
git pull --ff-only origin gh-pages

echo "== API =="
# Le Worker reste la source unique : on le copie, on ne le duplique pas
# dans le depot.
cp worker.js vps/worker.js

echo "== site =="
rsync -a --delete \
  --exclude '.git' --exclude 'vps' --exclude 'node_modules' \
  --exclude '*.sql' --exclude '*.md' --exclude '.github' \
  "$DEPOT/" "$SITE/"

# Le front appelle encore Cloudflare tant qu'on ne l'a pas bascule. On
# reecrit l'adresse sur la copie servie, pas dans le depot : ainsi un
# git pull ne se bat pas avec la modification.
grep -rl 'sasp-intranet-bot\.louisleurin\.workers\.dev' "$SITE" \
  | xargs -r sed -i "s|https://sasp-intranet-bot\.louisleurin\.workers\.dev|$API|g"

echo "== service =="
sudo systemctl restart sasp-api
sleep 2
curl -fsS "$API/health" && echo " -- API en vie"
