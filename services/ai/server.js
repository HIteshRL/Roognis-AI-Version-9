const express = require('express');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3002;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.locals.prisma = prisma;

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'ai' });
});

// Feature routes are intentionally added in later MVP parts.
app.use('/api/ai', (_req, res) => {
  res.status(404).json({ error: 'AI endpoint not implemented yet.' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[ai] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[ai] Service running on :${PORT}`);
});

async function shutdown(signal) {
  console.log(`[ai] ${signal} received. Shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
