#!/bin/sh
export VAULT_ADDR=http://localhost:8200
export VAULT_TOKEN=axshare-dev-token

# Abilita KV secrets engine v2
vault secrets enable -path=axshare kv-v2 2>/dev/null || true

# Scrivi i segreti applicazione
vault kv put axshare/app \
  secret_key="$(openssl rand -hex 32)" \
  postgres_password="${POSTGRES_PASSWORD:-changeme}" \
  redis_password="${REDIS_PASSWORD:-changeme}" \
  minio_root_password="${MINIO_ROOT_PASSWORD:-changeme}"

# Crea policy di lettura per l'app
vault policy write axshare-app - <<EOF
path "axshare/data/app" {
  capabilities = ["read"]
}
EOF

# Crea AppRole per autenticazione applicazione
vault auth enable approle 2>/dev/null || true
vault write auth/approle/role/axshare-app \
  token_policies="axshare-app" \
  token_ttl=1h \
  token_max_ttl=24h

# Stampa RoleID e SecretID
echo "RoleID: $(vault read -field=role_id auth/approle/role/axshare-app/role-id)"
echo "SecretID: $(vault write -f -field=secret_id auth/approle/role/axshare-app/secret-id)"
