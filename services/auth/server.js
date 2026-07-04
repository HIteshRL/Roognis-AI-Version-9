const express      = require('express');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth.routes');

const app  = express();
const PORT = process.env.PORT || 3001;

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
