# AXSHARE — Runbook Disaster Recovery

## Livelli di incidente

| Livello | Scenario | RTO | RPO |
|---------|----------|-----|-----|
| P1 | DB corrotto, dati persi | 4h | 24h |
| P2 | Server irraggiungibile | 2h | — |
| P3 | Storage MinIO/S3 perso | 8h | 24h |

## Procedura standard restore DB

### 1. Identifica backup disponibili

```bash
ls -lht /backups/axshare_*.sql.gz.gpg | head -10
# Oppure da S3:
aws s3 ls s3://BUCKET/backups/ --recursive | sort | tail -10
```

### 2. Dry run (SEMPRE prima di restore reale)

```bash
./infra/scripts/pg_restore.sh /backups/axshare_YYYYMMDD_HHMMSS.sql.gz.gpg --dry-run
```

Verifica output: deve mostrare le tabelle senza errori.

### 3. Restore su staging (verifica prima)

```bash
# Imposta variabili staging
export POSTGRES_HOST=staging-db.axshare.io
export POSTGRES_DB=axshare_staging
export POSTGRES_USER=axshare
export POSTGRES_PASSWORD=...
./infra/scripts/pg_restore.sh /backups/axshare_YYYYMMDD_HHMMSS.sql.gz.gpg
```

Verifica: conta utenti e file, testa login, testa download file.

### 4. Restore su produzione

```bash
# Solo dopo verifica su staging
export POSTGRES_HOST=prod-db.axshare.io
export POSTGRES_DB=axshare_prod
./infra/scripts/pg_restore.sh /backups/axshare_YYYYMMDD_HHMMSS.sql.gz.gpg
```

Digitare `RIPRISTINA` quando richiesto.

### 5. Post-restore checklist

- [ ] Backend risponde: `curl https://api.axshare.io/health`
- [ ] Login funziona
- [ ] Upload file funziona
- [ ] Download file funziona
- [ ] Audit log post-restore creato
- [ ] Notifica utenti (se dati persi)

## Chiave GPG per backup

La chiave GPG privata per decifrare i backup è custodita in:

- Vault HashiCorp: `axshare/backup-gpg-key`
- Backup fisico: cassaforte aziendale (envelope sigillato)

**Non perdere mai questa chiave — senza di essa i backup sono inutilizzabili.**

Per esportare/importare la chiave:

```bash
# Export (da fare SUBITO dopo la generazione):
gpg --export-secret-keys RECIPIENT_EMAIL > axshare-backup-key.gpg

# Import (in caso di disaster recovery):
gpg --import axshare-backup-key.gpg
```

## Script di backup e test

| Script | Uso |
|--------|-----|
| `infra/scripts/pg_backup.sh` | Backup cifrato (giornaliero via cron) |
| `infra/scripts/pg_backup.sh --test-mode` | Backup + verifica decifratura e integrità gzip |
| `infra/scripts/pg_restore.sh <file> [--dry-run]` | Restore da backup (sempre dry-run prima) |
| `infra/scripts/test_backup_integrity.sh` | Test integrità (checksum + decifratura + gzip), schedulabile in cron domenica 4:00 |

Per testare backup con decifratura: impostare `POSTGRES_*`, `BACKUP_GPG_RECIPIENT`, eseguire `pg_backup.sh --test-mode`. Output atteso: `BACKUP_OK|TIMESTAMP|SHA256|SIZE` e riga `TEST MODE: decifratura e integrità OK`.

## Contatti emergenza

| Ruolo | Contatto |
|-------|----------|
| DBA primario | admin@axshare.io |
| Security | security@axshare.io |
| Cloud infra | infra@axshare.io |
