#!/bin/sh
set -e
export VAULT_ADDR="http://127.0.0.1:8200"
export VAULT_TOKEN="dev-root-token"

echo "=== Inizializzazione Vault AXSHARE ==="

vault secrets enable -path=axshare kv-v2 2>/dev/null || true
vault secrets enable transit 2>/dev/null || true

vault write -f transit/keys/axshare-master-key \
  type=aes256-gcm96 exportable=false allow_plaintext_backup=false

vault policy write axshare-app - <<EOF
path "axshare/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "transit/encrypt/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/decrypt/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/rewrap/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/keys/axshare-master-key/rotate" {
  capabilities = ["update"]
}
EOF

echo "Vault pronto. KV: axshare/ | Transit key: axshare-master-key"
