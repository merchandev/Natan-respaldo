#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
test -f .env || { echo 'Falta configurar .env en el VPS'; exit 1; }
git pull --ff-only origin main
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
