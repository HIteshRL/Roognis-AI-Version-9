# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
ENV NPM_CONFIG_STRICT_SSL=false \
    NPM_CONFIG_REGISTRY=https://registry.yarnpkg.com \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NPM_CONFIG_STRICT_SSL=false \
    NPM_CONFIG_REGISTRY=https://registry.yarnpkg.com \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always

RUN apk add --no-cache curl openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate --schema=prisma/schema.prisma

EXPOSE 3002

CMD ["node", "server.js"]
