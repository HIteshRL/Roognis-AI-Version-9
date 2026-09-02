FROM node:20-alpine
WORKDIR /app
ARG NPM_STRICT_SSL=false
ARG NPM_REGISTRY=https://registry.yarnpkg.com
ARG NPM_REPLACE_REGISTRY_HOST=always
ARG PRISMA_NODE_TLS_REJECT_UNAUTHORIZED=0
ENV NPM_CONFIG_STRICT_SSL=$NPM_STRICT_SSL \
    NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=$NPM_REPLACE_REGISTRY_HOST

RUN apk add --no-cache curl openssl

COPY . .

RUN [ -f package.json ] && npm ci || true
RUN [ -f prisma/schema.prisma ] && NODE_TLS_REJECT_UNAUTHORIZED=$PRISMA_NODE_TLS_REJECT_UNAUTHORIZED npx prisma generate --schema=prisma/schema.prisma || true

EXPOSE 3005

CMD ["node", "server.js"]
