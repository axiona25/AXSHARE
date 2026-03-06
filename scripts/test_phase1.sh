#!/bin/bash
# Esegue i test Phase 1 (da root progetto)
# Richiede: docker compose up -d e .env configurato

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [ -f backend/.env.test ]; then
  set -a
  source backend/.env.test
  set +a
elif [ -f .env ]; then
  set -a
  source .env
  set +a
fi

cd backend
pytest tests/phase1/ -v "$@"
