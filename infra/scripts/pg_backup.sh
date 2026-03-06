#!/bin/bash
# pg_backup.sh — Backup PostgreSQL cifrato con GPG
# Uso: ./pg_backup.sh [--test-mode]
# Richiede: POSTGRES_*, BACKUP_GPG_RECIPIENT in .env.prod
# Output: /backups/axshare_YYYYMMDD_HHMMSS.sql.gz.gpg

set -euo pipefail

# ── Configurazione ──────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_HOST="${POSTGRES_HOST:-postgres}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-axshare}"
DB_USER="${POSTGRES_USER:-axshare}"
DB_PASS="${POSTGRES_PASSWORD}"
GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
TEST_MODE="${1:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/axshare_${TIMESTAMP}.sql.gz"
ENCRYPTED_FILE="${BACKUP_FILE}.gpg"
LOG_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.log"
CHECKSUM_FILE="${ENCRYPTED_FILE}.sha256"

# ── Funzioni ─────────────────────────────────────────────────────────────
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
die() { log "ERRORE: $*"; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
command -v pg_dump >/dev/null || die "pg_dump non trovato"
command -v gpg >/dev/null || die "gpg non trovato"
[ -n "${DB_PASS:-}" ] || die "POSTGRES_PASSWORD non impostata"
[ -n "${GPG_RECIPIENT:-}" ] || die "BACKUP_GPG_RECIPIENT non impostata"

log "Avvio backup AXSHARE — DB: ${DB_NAME}@${DB_HOST}:${DB_PORT}"
log "Output: ${ENCRYPTED_FILE}"

# ── Dump + compressione ───────────────────────────────────────────────────
export PGPASSWORD="$DB_PASS"

log "Esecuzione pg_dump..."
pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --compress=9 \
  -f - \
  --no-password \
  --verbose 2>>"$LOG_FILE" \
  | gzip -9 > "$BACKUP_FILE" \
  || die "pg_dump fallito"

DUMP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Dump completato: ${DUMP_SIZE}"

unset PGPASSWORD

# ── Cifratura GPG ─────────────────────────────────────────────────────────
log "Cifratura con GPG (recipient: ${GPG_RECIPIENT})..."
gpg \
  --batch \
  --yes \
  --trust-model always \
  --encrypt \
  --recipient "$GPG_RECIPIENT" \
  --output "$ENCRYPTED_FILE" \
  "$BACKUP_FILE" \
  || die "Cifratura GPG fallita"

# Rimuovi dump non cifrato
rm -f "$BACKUP_FILE"
log "Dump non cifrato rimosso."

# ── Checksum SHA-256 ──────────────────────────────────────────────────────
sha256sum "$ENCRYPTED_FILE" > "$CHECKSUM_FILE"
CHECKSUM=$(awk '{print $1}' < "$CHECKSUM_FILE")
log "SHA-256: ${CHECKSUM}"

ENCRYPTED_SIZE=$(du -sh "$ENCRYPTED_FILE" | cut -f1)
log "File cifrato: ${ENCRYPTED_SIZE}"

# ── Upload S3 (opzionale) ─────────────────────────────────────────────────
if [ -n "${S3_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
  log "Upload su S3: s3://${S3_BUCKET}/backups/"
  aws s3 cp "$ENCRYPTED_FILE" "s3://${S3_BUCKET}/backups/" \
    --storage-class STANDARD_IA \
    || log "ATTENZIONE: upload S3 fallito — backup locale disponibile"
  aws s3 cp "$CHECKSUM_FILE" "s3://${S3_BUCKET}/backups/" \
    || true
  log "Upload S3 completato."
fi

# ── Rotazione backup vecchi ───────────────────────────────────────────────
log "Rotazione: rimuovo backup più vecchi di ${RETENTION_DAYS} giorni..."
find "$BACKUP_DIR" -name "axshare_*.sql.gz.gpg" -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name "axshare_*.sql.gz.gpg.sha256" -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "*.sha256" -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "backup_*.log" -mtime "+${RETENTION_DAYS}" -delete

REMAINING=$(find "$BACKUP_DIR" -name "axshare_*.sql.gz.gpg" 2>/dev/null | wc -l)
log "Backup disponibili: ${REMAINING}"

# ── Test mode: verifica decifratura ──────────────────────────────────────
if [ "${TEST_MODE:-}" = "--test-mode" ]; then
  log "TEST MODE: verifico decifratura..."
  TEST_OUT="${BACKUP_DIR}/test_decrypt_$$.sql.gz"
  gpg --batch --yes --decrypt --output "$TEST_OUT" "$ENCRYPTED_FILE" \
    || die "Test decifratura FALLITO"
  gzip -t "$TEST_OUT" || die "Test integrità gzip FALLITO"
  rm -f "$TEST_OUT"
  log "TEST MODE: decifratura e integrità OK"
fi

log "Backup completato con successo: ${ENCRYPTED_FILE}"
echo "BACKUP_OK|${TIMESTAMP}|${CHECKSUM}|${ENCRYPTED_SIZE}"
