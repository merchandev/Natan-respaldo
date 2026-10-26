#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only origin main
docker compose config --quiet
# Solo el proyecto actual; no detener otros stacks ni eliminar volúmenes.
docker compose up -d --build --wait app
docker compose ps
