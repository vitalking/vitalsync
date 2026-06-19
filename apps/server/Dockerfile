# Dockerfile del servidor agregador VITALSYNC v2.
# IMPORTANTE: construir con el CONTEXTO en la RAÍZ del repositorio:
#   docker build -f apps/server/Dockerfile -t vitalsync-server .
#
# En Railway/Render/Fly, configurar:
#   - Dockerfile path: apps/server/Dockerfile
#   - Build context:   raíz del repositorio

# ---- Etapa de build ----
FROM node:20-slim AS build
WORKDIR /app

# Manifiestos primero (mejor cache de capas).
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm install

# Código y build del servidor (tsup empaqueta @vitalsync/shared).
COPY . .
RUN npm run build --workspace=apps/server

# ---- Etapa de runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV SOURCE_MODE=auto

# node_modules (raíz, con ws y dotenv hoisteados) + bundle del servidor.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json

EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
