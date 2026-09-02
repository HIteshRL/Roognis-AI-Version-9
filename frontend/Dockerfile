FROM node:20-alpine
WORKDIR /app/frontend

RUN apk add --no-cache curl

COPY frontend/ ./
COPY packages/learning-events/ /app/packages/learning-events/

EXPOSE 3000

CMD ["sh", "-c", "[ -f package.json ] && npm start || (echo 'Frontend stub — replace this Dockerfile' && sleep infinity)"]
