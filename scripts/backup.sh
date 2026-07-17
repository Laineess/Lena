#!/usr/bin/env bash
# Respaldo diario cifrado (RS-T-14). En el VPS corre por cron:
#   0 3 * * *  BACKUP_PASSPHRASE=... /home/lena/scripts/backup.sh
#
# El respaldo se cifra en reposo (AES-256) porque va FUERA del VPS. La llave
# NO vive junto al dato: es una variable de entorno del cron, no un archivo.
set -euo pipefail

DIR="${BACKUP_DIR:-./backups}"
DB="${POSTGRES_DB:-lena}"
USUARIO="${POSTGRES_USER:-lena}"
PASS="${BACKUP_PASSPHRASE:?define BACKUP_PASSPHRASE}"
RETENCION="${BACKUP_RETENCION:-30}" # días
COMPOSE="${COMPOSE:-docker compose}"

mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVO="$DIR/lena-$STAMP.sql.gz.gpg"

# pg_dump → gzip → gpg (cifrado simétrico). Todo en tubería: nada sin cifrar en disco.
$COMPOSE exec -T postgres pg_dump -U "$USUARIO" "$DB" |
  gzip |
  gpg --batch --yes --passphrase "$PASS" --symmetric --cipher-algo AES256 -o "$ARCHIVO"

echo "✓ Respaldo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# Rotación local (RS-T-14: retención 30 días).
find "$DIR" -name 'lena-*.sql.gz.gpg' -mtime +"$RETENCION" -delete

# FUERA DEL VPS: sincronizar $DIR a otro host o bucket (rclone/scp). Un respaldo
# en el mismo disco que la base no sobrevive a la pérdida del disco.
if [ -n "${BACKUP_REMOTO:-}" ]; then
  rclone copy "$ARCHIVO" "$BACKUP_REMOTO" && echo "✓ Copiado a $BACKUP_REMOTO"
fi
