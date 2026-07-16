#!/usr/bin/env bash
# Despliegue en un comando (RNF-M-4). Desde la máquina de desarrollo:
#
#   pnpm deploy
#
# Entra al VPS por SSH, trae los cambios, reconstruye las imágenes, corre las
# migraciones (como DUEÑO, no como lena_app) y levanta todo. Idempotente.
#
# Requisitos en el VPS (ver Docs/11 y Docs/12):
#   - /home/lena con el repo clonado y un .env de producción (DATABASE_URL,
#     DATABASE_URL_APP apuntando a postgres:5432, JWT_SECRET, dominio en Caddyfile)
#   - Docker + Docker Compose
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@129.121.63.192}"
VPS_PORT="${VPS_PORT:-22022}"
VPS_KEY="${VPS_KEY:-$HOME/serverid_rsa}"
VPS_PATH="${VPS_PATH:-/home/lena}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "▶ Desplegando Leña en ${VPS_HOST}:${VPS_PATH}"

ssh -i "$VPS_KEY" -p "$VPS_PORT" "$VPS_HOST" bash -s <<REMOTO
set -euo pipefail
cd "${VPS_PATH}"

echo "· git pull"
git pull --ff-only

echo "· construyendo imágenes"
${COMPOSE} build

echo "· migraciones (dueño de la base)"
# Las migraciones corren como DUEÑO (DATABASE_URL), no como lena_app. El .env
# del VPS no entra a la imagen (.dockerignore), así que se pasa por -e.
set -a; . ./.env; set +a
${COMPOSE} run --rm -e DATABASE_URL="\${DATABASE_URL}" api node --import tsx packages/db/src/migrate.ts

echo "· levantando servicios"
${COMPOSE} up -d

echo "· estado"
${COMPOSE} ps
REMOTO

echo "✓ Despliegue terminado"
