# S1 — Campanhas. Contexto de build = RAIZ do monorepo (para copiar contracts/):
#   docker build -f services/campaigns/Dockerfile -t rpg-nexus/campaigns .
FROM node:24-alpine AS build

WORKDIR /app

COPY services/campaigns/package.json services/campaigns/package-lock.json ./
RUN npm ci

COPY services/campaigns/tsconfig.json ./
COPY services/campaigns/src/ ./src/
RUN npm run build

FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY services/campaigns/package.json services/campaigns/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/ ./dist/
COPY contracts/ /app/contracts/

ENV CONTRACTS_DIR=/app/contracts

USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health > /dev/null || exit 1

CMD ["node", "dist/server.js"]
