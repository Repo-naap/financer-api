#!/usr/bin/env bash
# =============================================================================
# FINANCER – Restauração Segura do PostgreSQL (pg_restore)
# Uso: ./scripts/restore-postgres.sh ./backups/financer_pg_YYYYMMDD_HHMMSS.dump
# =============================================================================
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Uso: $0 <caminho_do_arquivo.dump>"
  exit 1
fi

DUMP_FILE="$1"
if [ ! -f "$DUMP_FILE" ]; then
  echo "Erro: Arquivo $DUMP_FILE não encontrado."
  exit 1
fi

if [ -f "${DUMP_FILE}.sha256" ]; then
  echo "[1/3] Validando integridade SHA-256 do backup..."
  sha256sum -c "${DUMP_FILE}.sha256"
fi

echo "[2/3] Restaurando banco de dados PostgreSQL..."
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DUMP_FILE"

echo "[3/3] Reiniciando serviço FINANCER..."
docker compose restart financer
echo "[FINANCER] Restauração concluída com sucesso!"
