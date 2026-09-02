const express      = require('express');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth.routes');

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

// Health check — no auth, used by Docker healthcheck and Traefik
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'auth' }));

app.use('/api/auth', authRoutes);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[auth] Service running on :${PORT}`);
});

// A stray throw outside the request path would otherwise crash the process
// silently under Node's default behavior, taking down every concurrently
// in-flight request with it — worst at peak load, and this is the front
// door every login goes through. Log with full context and exit so the
// container's `restart: unless-stopped` policy brings it back.
process.on('uncaughtException', err => {
  console.error('[auth] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error('[auth] unhandledRejection:', reason);
  process.exit(1);
});
