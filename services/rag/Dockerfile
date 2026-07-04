FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY . .

RUN [ -f requirements.txt ] && pip install --no-cache-dir -r requirements.txt || true

EXPOSE 3003

CMD ["sh", "-c", "[ -f main.py ] && python main.py || (echo 'RAG stub running' && sleep infinity)"]
