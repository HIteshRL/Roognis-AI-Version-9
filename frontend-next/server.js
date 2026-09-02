const http = require('http');
const next = require('next');
const { proxyApiRequest, normalizeProxyTarget } = require('./lib/proxyApiRequest');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEV = process.env.NODE_ENV !== 'production';
const API_PROXY_TARGET = normalizeProxyTarget(
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1'
);

const app = next({ dev: DEV });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    if (urlPath.startsWith('/api/')) {
      proxyApiRequest(req, res, API_PROXY_TARGET);
      return;
    }
    handle(req, res);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[frontend] running at http://${HOST}:${PORT}`);
    console.log(`[frontend] proxying /api/* to ${API_PROXY_TARGET}`);
  });
});
