# S4 - Identidade e historico. Contexto de build = raiz do repositorio.
FROM node:24-alpine AS build

WORKDIR /app
COPY services/identity/package.json services/identity/package-lock.json ./
RUN npm ci
COPY services/identity/tsconfig.json ./
COPY services/identity/src/ ./src/
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY services/identity/package.json services/identity/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/ ./dist/
COPY contracts/ ./contracts/
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health > /dev/null || exit 1
CMD ["node", "dist/server.js"]
