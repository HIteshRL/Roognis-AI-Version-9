require('./load-env');

const express      = require('express');
const cookieParser = require('cookie-parser');

const analyticsRoutes = require('./routes/analytics.routes');

const app  = express();
const PORT = process.env.PORT || 3004;

app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'analytics' }));

app.use('/api/analytics', analyticsRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const server = app.listen(PORT, () => {
  console.log(`[analytics] Service running on :${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[analytics] Port ${PORT} is already in use. Stop the other process or change PORT in .env`
    );
    process.exit(1);
  }
  throw err;
});
