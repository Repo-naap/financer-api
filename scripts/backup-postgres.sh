#!/usr/bin/env bash
# =============================================================================
# FINANCER – Backup Manual / Agendado do PostgreSQL (pg_dump)
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
OUT_FILE="${BACKUP_DIR}/financer_pg_${STAMP}.dump"

echo "[FINANCER] Gerando backup PostgreSQL em ${OUT_FILE}..."
docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$OUT_FILE"

sha256sum "$OUT_FILE" > "${OUT_FILE}.sha256"
echo "[FINANCER] Backup concluído com sucesso! Checksum salvo em ${OUT_FILE}.sha256"
echo "[DICA] Recomenda-se copiar a pasta ./backups para armazenamento externo (S3, Google Drive ou servidor secundário)."
