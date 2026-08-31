#!/bin/bash
# Met a jour le VPS quand le site est servi par Next.
# Variante de mettre-a-jour.sh : les pages vont dans web/public/ au lieu
# de /var/www/sasp, et Next est recompile.
set -euo pipefail

DEPOT=/opt/sasp
PUB="$DEPOT/web/public"
API=${API_URL:?donner API_URL, par exemple https://sasp.exemple.fr}

echo "== depot =="
cd "$DEPOT"
git pull --ff-only origin gh-pages

echo "== API =="
# Le Worker reste la source unique : on le copie, on ne le duplique pas
# dans le depot.
cp worker.js vps/worker.js

echo "== pages =="
mkdir -p "$PUB"
rsync -a --delete \
  --exclude '.git' --exclude 'vps' --exclude 'web' --exclude 'node_modules' \
  --exclude '*.sql' --exclude '*.md' --exclude '.github' \
  "$DEPOT/" "$PUB/"

# Le front appelle encore l'adresse d'hier tant qu'on ne la reecrit pas.
# On le fait sur la copie servie, pas dans le depot : ainsi un git pull
# ne se bat pas avec la modification.
grep -rl 'sasp-intranet-bot\.louisleurin\.workers\.dev' "$PUB" 2>/dev/null \
  | xargs -r sed -i "s|https://sasp-intranet-bot\.louisleurin\.workers\.dev|$API|g"

echo "== compilation =="
cd "$DEPOT/web"
npm ci --no-audit --no-fund
npm run build

echo "== services =="
sudo systemctl restart sasp-api sasp-web
sleep 3
curl -fsS "$API/health"   && echo " -- API en vie"
curl -fsS -o /dev/null -w "   -- site : %{http_code}\n" "$API/"
curl -fsS -o /dev/null -w "   -- etat : %{http_code}\n" "$API/etat"
