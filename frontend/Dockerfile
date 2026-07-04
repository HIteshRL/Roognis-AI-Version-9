FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl

COPY . .

RUN [ -f package.json ] && npm ci || true

EXPOSE 3000

CMD ["sh", "-c", "[ -f package.json ] && npm start || (echo 'Frontend stub — replace this Dockerfile' && sleep infinity)"]
