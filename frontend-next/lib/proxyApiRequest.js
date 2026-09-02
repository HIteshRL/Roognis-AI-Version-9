const http = require('http');
const https = require('https');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function normalizeProxyTarget(value) {
  const raw = String(value || '').trim() || 'http://127.0.0.1';
  const withoutApiSuffix = raw.endsWith('/api') ? raw.slice(0, -4) : raw;
  return withoutApiSuffix.replace(/\/+$/, '');
}

function proxyApiRequest(clientReq, clientRes, apiProxyTarget) {
  let target;
  try {
    target = new URL(clientReq.url, apiProxyTarget);
  } catch (error) {
    clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    clientRes.end(JSON.stringify({ error: 'Invalid API proxy target.' }));
    return;
  }

  const headers = {};
  for (const [name, value] of Object.entries(clientReq.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers.host = target.host;

  const requestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: clientReq.method,
    path: `${target.pathname}${target.search}`,
    headers,
  };

  const transport = target.protocol === 'https:' ? https : http;
  const proxyReq = transport.request(requestOptions, proxyRes => {
    const responseHeaders = {};
    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }
    clientRes.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', error => {
    if (clientRes.headersSent) {
      clientRes.destroy(error);
      return;
    }
    clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    clientRes.end(JSON.stringify({
      error: 'Backend API is not reachable from the frontend server.',
      target: apiProxyTarget,
    }));
  });

  clientReq.pipe(proxyReq);
}

module.exports = { proxyApiRequest, normalizeProxyTarget, HOP_BY_HOP_HEADERS };
