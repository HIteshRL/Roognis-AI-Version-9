# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
# Install all deps including prisma CLI (needed for db push + generate)
RUN npm install --legacy-peer-deps

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# curl for healthcheck, openssl required by Prisma schema engine binary on Alpine
RUN apk add --no-cache curl openssl

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Generate Prisma client at build time
# NODE_TLS_REJECT_UNAUTHORIZED=0 handles self-signed certs on corporate/VPN networks
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate --schema=prisma/schema.prisma

EXPOSE 3001

# docker-compose overrides this CMD with db push + seed + node server.js
CMD ["node", "server.js"]
