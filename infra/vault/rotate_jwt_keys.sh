#!/bin/sh
# Rota le chiavi JWT (RS256) e le salva in Vault
# Eseguire periodicamente (es. ogni 90 giorni)
# Richiede: VAULT_ADDR, VAULT_TOKEN (o AppRole) già impostati

export VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"

# Genera nuova coppia RSA
openssl genrsa -out /tmp/jwt_private.pem 2048
openssl rsa -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem

# Carica in Vault (mount axshare, path jwt-keys)
vault kv put axshare/jwt-keys \
  private_key="$(cat /tmp/jwt_private.pem)" \
  public_key="$(cat /tmp/jwt_public.pem)" \
  rotated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Pulisci
rm -f /tmp/jwt_private.pem /tmp/jwt_public.pem
echo "Chiavi JWT ruotate e salvate in Vault"
