# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
ARG NPM_STRICT_SSL=false
ARG NPM_REGISTRY=https://registry.yarnpkg.com
ARG NPM_REPLACE_REGISTRY_HOST=always
ENV NPM_CONFIG_STRICT_SSL=$NPM_STRICT_SSL \
    NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=$NPM_REPLACE_REGISTRY_HOST

COPY package.json package-lock.json* ./
# Install all deps including prisma CLI (needed for db push + generate)
RUN npm install --legacy-peer-deps

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ARG PRISMA_NODE_TLS_REJECT_UNAUTHORIZED=0

# curl for healthcheck, openssl required by Prisma schema engine binary on Alpine
RUN apk add --no-cache curl openssl

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Generate Prisma client at build time
RUN NODE_TLS_REJECT_UNAUTHORIZED=$PRISMA_NODE_TLS_REJECT_UNAUTHORIZED npx prisma generate --schema=prisma/schema.prisma

EXPOSE 3001

# docker-compose overrides this CMD with db push + seed + node server.js
CMD ["node", "server.js"]
