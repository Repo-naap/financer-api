#!/usr/bin/env bash
# =============================================================================
# FINANCER – Instalador Automatizado para Servidor Linux (Ubuntu/Debian)
# Instala Docker + Docker Compose, gera segredos aleatórios, sobe PostgreSQL,
# FINANCER e HTTPS automático via Caddy.
# =============================================================================
set -euo pipefail

echo "==========================================================="
echo "  FINANCER – Gestão Financeira | Instalação em Servidor"
echo "==========================================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "[1/4] Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi

if [ ! -f .env ]; then
  echo "[2/4] Gerando arquivo .env com credenciais aleatórias seguras..."
  PG_PASS=$(openssl rand -hex 20)
  SESS_SECRET=$(openssl rand -hex 48)
  read -rp "Informe o domínio do escritório (ex: financer.escritorio.com.br) ou deixe vazio para acesso por IP: " DOMAIN

  cat > .env <<EOF
NODE_ENV=production
APP_PORT=3001
POSTGRES_DB=financer_db
POSTGRES_USER=financer
POSTGRES_PASSWORD=${PG_PASS}
SESSION_SECRET=${SESS_SECRET}
SESSION_TTL_HOURS=12
CORS_ORIGIN=*
FINANCER_DOMAIN=${DOMAIN:-localhost}
EOF
  chmod 600 .env
  echo ".env criado com sucesso (permissão 600)."
else
  echo "[2/4] Arquivo .env já existente preservado."
fi

mkdir -p backups

echo "[3/4] Compilando e iniciando containers (PostgreSQL + FINANCER + Backup diário)..."
if grep -q "FINANCER_DOMAIN=localhost" .env; then
  docker compose up -d --build
  echo "[4/4] FINANCER disponível em http://$(hostname -I | awk '{print $1}'):3001"
else
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  DOMAIN_VAL=$(grep FINANCER_DOMAIN .env | cut -d= -f2)
  echo "[4/4] FINANCER disponível com HTTPS automático em https://${DOMAIN_VAL}"
fi

echo "Acesse o endereço no navegador para concluir o Primeiro Acesso (Setup Inicial)."
