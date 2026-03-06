#!/bin/bash
# Attende che i servizi dello stack AXSHARE siano raggiungibili.
# Uso: ./scripts/wait-for-infra.sh [timeout_secondi]
# Dipendenze: nc (netcat) o timeout + bash. Su macOS: nc, su Alpine: nc.

set -e
TIMEOUT="${1:-120}"
ELAPSED=0
INTERVAL=3

check() {
  if command -v nc >/dev/null 2>&1; then
    nc -z "$1" "$2" 2>/dev/null
  elif command -v timeout >/dev/null 2>&1 && command -v bash >/dev/null 2>&1; then
    timeout 1 bash -c "echo >/dev/tcp/$1/$2" 2>/dev/null
  else
    echo "Installa netcat (nc) per usare questo script."
    exit 1
  fi
}

echo "Attesa servizi (timeout ${TIMEOUT}s)..."
until check localhost 5432 && check localhost 6379 && check localhost 9000 && check localhost 8200; do
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "Timeout: alcuni servizi non sono pronti."
    exit 1
  fi
  echo "  in attesa (${ELAPSED}s)..."
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done
echo "PostgreSQL, Redis, MinIO e Vault sono raggiungibili."
