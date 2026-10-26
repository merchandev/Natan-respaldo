#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only origin main
if test -f .deploy-private/active.json; then
  exec python3 deploy/enable_https.py --apply
fi
docker compose config --quiet
# Solo el proyecto actual; no detener otros stacks ni eliminar volúmenes.
docker compose up -d --build --wait app
docker compose ps
