#!/bin/bash
# pg_restore.sh — Restore PostgreSQL da backup cifrato GPG
# Uso: ./pg_restore.sh <backup_file.sql.gz.gpg> [--dry-run]
#
# ATTENZIONE: sovrascrive il database di destinazione.
# Usare SEMPRE un ambiente di staging prima di ripristinare in produzione.

set -euo pipefail

BACKUP_FILE="${1:-}"
DRY_RUN="${2:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
WORK_DIR="/tmp/axshare_restore_${TIMESTAMP}"
LOG_FILE="/tmp/restore_${TIMESTAMP}.log"

DB_HOST="${POSTGRES_HOST:-postgres}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-axshare}"
DB_USER="${POSTGRES_USER:-axshare}"
DB_PASS="${POSTGRES_PASSWORD}"

log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
die()  { log "ERRORE: $*"; exit 1; }
warn() { log "ATTENZIONE: $*"; }

# ── Validazione input ─────────────────────────────────────────────────────
[ -n "$BACKUP_FILE" ] || die "Uso: $0 <backup_file.sql.gz.gpg> [--dry-run]"
[ -f "$BACKUP_FILE" ] || die "File non trovato: ${BACKUP_FILE}"
[[ "$BACKUP_FILE" == *.gpg ]] || warn "Il file non ha estensione .gpg — potrebbe non essere cifrato"

log "═══════════════════════════════════════════"
log "AXSHARE — Procedura Disaster Recovery"
log "Backup: ${BACKUP_FILE}"
log "Target DB: ${DB_NAME}@${DB_HOST}:${DB_PORT}"
[ "$DRY_RUN" = "--dry-run" ] && log "DRY RUN — nessuna modifica al DB"
log "═══════════════════════════════════════════"

# ── Verifica checksum se disponibile ─────────────────────────────────────
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ -f "$CHECKSUM_FILE" ]; then
  log "Verifica checksum SHA-256..."
  sha256sum -c "$CHECKSUM_FILE" || die "Checksum non valido — file corrotto"
  log "Checksum OK."
else
  warn "File checksum non trovato — verifica integrità saltata"
fi

# ── Decifratura ───────────────────────────────────────────────────────────
mkdir -p "$WORK_DIR"
DECRYPTED_GZ="${WORK_DIR}/dump.sql.gz"
DECRYPTED_DUMP="${WORK_DIR}/dump.custom"

log "Decifratura GPG..."
gpg --batch --yes --decrypt --output "$DECRYPTED_GZ" "$BACKUP_FILE" \
  || die "Decifratura GPG fallita — chiave privata disponibile?"

log "Verifica integrità gzip..."
gzip -t "$DECRYPTED_GZ" || die "File compresso corrotto"

log "Decompressione gzip..."
gunzip -c "$DECRYPTED_GZ" > "$DECRYPTED_DUMP" || die "Decompressione fallita"
rm -f "$DECRYPTED_GZ"

DUMP_SIZE=$(du -sh "$DECRYPTED_DUMP" | cut -f1)
log "Dump pronto: ${DUMP_SIZE}"

# ── Dry run: solo verifica contenuto ─────────────────────────────────────
if [ "$DRY_RUN" = "--dry-run" ]; then
  log "DRY RUN: listing contenuto dump..."
  pg_restore --list "$DECRYPTED_DUMP" 2>/dev/null | head -20 || true
  log "DRY RUN completato. Il database NON è stato modificato."
  rm -rf "$WORK_DIR"
  exit 0
fi

# ── Conferma utente ───────────────────────────────────────────────────────
log ""
log "⚠️  ATTENZIONE: Questa operazione SOVRASCRIVE il database '${DB_NAME}'"
log "    su ${DB_HOST}:${DB_PORT}"
log ""
read -p "Digitare 'RIPRISTINA' per confermare: " CONFIRM
[ "$CONFIRM" = "RIPRISTINA" ] || die "Restore annullato dall'utente."

# ── Backup del DB corrente prima del restore ──────────────────────────────
log "Backup preventivo del DB corrente..."
SAFETY_BACKUP="${WORK_DIR}/pre_restore_safety.custom"
export PGPASSWORD="$DB_PASS"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --format=custom -f "$SAFETY_BACKUP" \
  || warn "Backup preventivo fallito — continuo comunque"
log "Backup preventivo: ${SAFETY_BACKUP}"

# ── Drop e ricrea DB ──────────────────────────────────────────────────────
log "Terminazione connessioni attive..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  || warn "Impossibile terminare connessioni"

log "Drop database ${DB_NAME}..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS ${DB_NAME};" \
  || die "DROP DATABASE fallito"

log "Creazione database ${DB_NAME}..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" \
  || die "CREATE DATABASE fallito"

# ── Restore ───────────────────────────────────────────────────────────────
log "Restore in corso..."
pg_restore \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --verbose \
  --no-password \
  --exit-on-error \
  "$DECRYPTED_DUMP" \
  2>>"$LOG_FILE" \
  || die "pg_restore fallito — DB in stato inconsistente. Safety backup: ${SAFETY_BACKUP}"

unset PGPASSWORD

log "Restore completato con successo."

# ── Post-restore checks ───────────────────────────────────────────────────
log "Verifica post-restore..."
export PGPASSWORD="$DB_PASS"

USERS_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ' || echo "ERR")
FILES_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -t -c "SELECT COUNT(*) FROM files;" 2>/dev/null | tr -d ' ' || echo "ERR")

unset PGPASSWORD

log "Utenti nel DB: ${USERS_COUNT}"
log "File nel DB:   ${FILES_COUNT}"

# ── Pulizia ───────────────────────────────────────────────────────────────
rm -rf "$WORK_DIR"
log "Log disponibile: ${LOG_FILE}"
log "═══════════════════════════════════════════"
log "RESTORE COMPLETATO"
log "═══════════════════════════════════════════"
