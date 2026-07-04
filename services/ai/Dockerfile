FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl

COPY . .

RUN [ -f package.json ] && npm ci || true
RUN [ -f prisma/schema.prisma ] && npx prisma generate --schema=prisma/schema.prisma || true

EXPOSE 3002

CMD ["node", "server.js"]
