FROM node:20-alpine
WORKDIR /app
ENV NPM_CONFIG_STRICT_SSL=false \
    NPM_CONFIG_REGISTRY=https://registry.yarnpkg.com \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always

# openssl required by Prisma query engine on Alpine (same as auth/ai services)
RUN apk add --no-cache curl openssl

COPY . .

RUN [ -f package.json ] && npm ci || true
RUN [ -f prisma/schema.prisma ] && NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate --schema=prisma/schema.prisma || true

EXPOSE 3004

CMD ["node", "server.js"]
