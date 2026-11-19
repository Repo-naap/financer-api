# =============================================================================
# FINANCER – Gestão Financeira | Dockerfile de Produção (Multi-stage)
# =============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

# Instalar dependências do backend e frontend
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm --prefix backend ci && npm --prefix frontend ci

# Copiar código-fonte e compilar
COPY backend ./backend
COPY frontend ./frontend
RUN npm --prefix backend run build && npm --prefix frontend run build

# Imagem final limpa e segura
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV SERVE_FRONTEND=true

COPY backend/package*.json ./backend/
RUN npm --prefix backend ci --omit=dev

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/sql ./backend/sql
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/backups && chown -R node:node /app
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "backend/dist/index.js"]
