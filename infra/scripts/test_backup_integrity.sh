#!/bin/bash
# test_backup_integrity.sh — Verifica settimanale integrità backup
# Schedulare in cron: 0 4 * * 0 /infra/scripts/test_backup_integrity.sh
# Invia alert se backup fallisce o è troppo vecchio

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
ALERT_EMAIL="${ALERT_EMAIL_CRITICAL:-admin@axshare.io}"
LOG_FILE="/tmp/backup_test_$(date +%Y%m%d).log"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
send_alert() {
  local subject="$1"
  local body="$2"
  echo "$body" | mail -s "$subject" "$ALERT_EMAIL" 2>/dev/null || \
    log "ALERT (mail non inviata): ${subject}"
}

log "Test integrità backup AXSHARE..."

# 1. Trova backup più recente (portabile: ls -t)
LATEST=""
for f in "$BACKUP_DIR"/axshare_*.sql.gz.gpg; do
  [ -f "$f" ] || continue
  if [ -z "$LATEST" ] || [ "$f" -nt "$LATEST" ]; then
    LATEST="$f"
  fi
done

if [ -z "$LATEST" ]; then
  send_alert "AXSHARE: Nessun backup trovato" \
    "Nessun file di backup trovato in ${BACKUP_DIR}"
  exit 1
fi

log "Backup più recente: ${LATEST}"

# 2. Verifica età (portabile: find -mmin)
MAX_AGE_MINS=$((MAX_AGE_HOURS * 60))
if find "$LATEST" -mmin "+${MAX_AGE_MINS}" 2>/dev/null | grep -q .; then
  BACKUP_AGE_HOURS=""
  if [ -n "$(stat -c %Y "$LATEST" 2>/dev/null)" ]; then
    NOW=$(date +%s)
    MTIME=$(stat -c %Y "$LATEST" 2>/dev/null)
    BACKUP_AGE_HOURS=$(( (NOW - MTIME) / 3600 ))
  else
    BACKUP_AGE_HOURS=">${MAX_AGE_HOURS}"
  fi
  send_alert "AXSHARE: Backup troppo vecchio (${BACKUP_AGE_HOURS}h)" \
    "Il backup più recente ha ${BACKUP_AGE_HOURS} ore. Max consentito: ${MAX_AGE_HOURS}h"
fi

# 3. Verifica checksum
CHECKSUM_FILE="${LATEST}.sha256"
if [ -f "$CHECKSUM_FILE" ]; then
  if ! sha256sum -c "$CHECKSUM_FILE" >/dev/null 2>&1; then
    send_alert "AXSHARE: Checksum backup non valido" \
      "Il file ${LATEST} ha checksum non valido — possibile corruzione"
    exit 1
  fi
  log "Checksum OK."
else
  log "ATTENZIONE: checksum file non trovato per ${LATEST}"
fi

# 4. Test decifratura (senza restore al DB)
log "Test decifratura GPG..."
TEMP_OUT="/tmp/axshare_backup_test_$$.sql.gz"
if ! gpg --batch --yes --decrypt --output "$TEMP_OUT" "$LATEST" 2>>"$LOG_FILE"; then
  send_alert "AXSHARE: Decifratura backup fallita" \
    "Impossibile decifrare ${LATEST} — chiave GPG disponibile?"
  rm -f "$TEMP_OUT"
  exit 1
fi

# 5. Test integrità gzip
if ! gzip -t "$TEMP_OUT" 2>/dev/null; then
  rm -f "$TEMP_OUT"
  send_alert "AXSHARE: Backup corrotto (gzip non valido)" \
    "Il dump ${LATEST} è corrotto dopo la decifratura"
  exit 1
fi

DUMP_SIZE=$(du -sh "$TEMP_OUT" | cut -f1)
rm -f "$TEMP_OUT"

log "Test completato: backup valido, ${DUMP_SIZE} decompressi"
log "BACKUP_TEST_OK|$(date -u +%Y-%m-%dT%H:%M:%SZ)|${LATEST}|${MAX_AGE_HOURS}h"
