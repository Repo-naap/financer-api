#!/usr/bin/env bash
# =============================================================================
# FINANCER – Atualização Segura Sem Perda de Dados
# 1. Gera backup prévio obrigatório
# 2. Recompila aplicação
# 3. Aplica novas migrações SQL automaticamente no boot preservando os dados
# =============================================================================
set -euo pipefail

echo "[1/3] Realizando backup preventivo antes da atualização..."
./scripts/backup-postgres.sh

echo "[2/3] Atualizando imagem do FINANCER (banco de dados preservado)..."
docker compose build financer

echo "[3/3] Subindo nova versão com migrações automáticas..."
if [ -f .env ] && ! grep -q "FINANCER_DOMAIN=localhost" .env; then
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d financer
else
  docker compose up -d financer
fi

echo "[FINANCER] Atualização concluída preservando usuários, lançamentos, auditoria e configurações."
