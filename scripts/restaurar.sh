#!/usr/bin/env bash
# Restaura un respaldo cifrado (RS-T-15: el simulacro trimestral).
#
#   BACKUP_PASSPHRASE=... scripts/restaurar.sh backups/lena-XXXX.sql.gz.gpg [db_destino]
#
# Por defecto restaura a una base APARTE (lena_restore) para verificar sin
# tocar la de producción. "Un respaldo que nunca se restauró es una hipótesis."
set -euo pipefail

ARCHIVO="${1:?uso: restaurar.sh <archivo.sql.gz.gpg> [db_destino]}"
DB="${2:-lena_restore}"
USUARIO="${POSTGRES_USER:-lena}"
PASS="${BACKUP_PASSPHRASE:?define BACKUP_PASSPHRASE}"
COMPOSE="${COMPOSE:-docker compose}"

echo "▶ Restaurando $ARCHIVO en la base '$DB'"
$COMPOSE exec -T postgres psql -U "$USUARIO" -d postgres -c "DROP DATABASE IF EXISTS $DB;"
$COMPOSE exec -T postgres psql -U "$USUARIO" -d postgres -c "CREATE DATABASE $DB;"

gpg --batch --yes --passphrase "$PASS" --decrypt "$ARCHIVO" |
  gunzip |
  $COMPOSE exec -T postgres psql -U "$USUARIO" -d "$DB" -q

# Verificación: contar tablas restauradas (un restore vacío no sirve).
TABLAS=$($COMPOSE exec -T postgres psql -U "$USUARIO" -d "$DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
echo "✓ Restaurado en '$DB' — $TABLAS tablas"
