# Frontend (React + Vite). Contexto de build = esta pasta:
#   docker build -t rpg-nexus/frontend apps/frontend
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# As URLs dos serviços são vistas pelo NAVEGADOR e ficam gravadas no build.
ARG VITE_CHARACTERS_URL=http://localhost:8000
ARG VITE_CAMPAIGNS_URL=http://localhost:3001
ARG VITE_INVENTORY_URL=http://localhost:8080
ARG VITE_ACTIONS_URL=http://localhost:3002
ENV VITE_CHARACTERS_URL=$VITE_CHARACTERS_URL \
    VITE_CAMPAIGNS_URL=$VITE_CAMPAIGNS_URL \
    VITE_INVENTORY_URL=$VITE_INVENTORY_URL \
    VITE_ACTIONS_URL=$VITE_ACTIONS_URL

RUN npm run build

USER node

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5173/ || exit 1

# `vite preview` serve o build e devolve index.html nas rotas do roteador (History API).
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
