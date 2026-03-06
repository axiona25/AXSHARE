#!/bin/bash
set -e
echo "=== AXSHARE Setup ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

mkdir -p keys

if [ ! -f keys/jwt_private.pem ]; then
  echo "Generazione chiavi JWT RS256..."
  openssl genrsa -out keys/jwt_private.pem 4096
  openssl rsa -in keys/jwt_private.pem -pubout -out keys/jwt_public.pem
  chmod 600 keys/jwt_private.pem
  echo "Chiavi JWT generate in keys/"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env creato — compila i valori mancanti"
fi

cd backend
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt

cd "$ROOT_DIR/frontend"
npm install

echo "=== Setup completato ==="
echo "Prossimo step: esegui 'docker compose up -d'"
