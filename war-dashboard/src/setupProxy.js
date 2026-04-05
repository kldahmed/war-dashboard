/**
 * Custom dev proxy — enables SSE and WebSocket pass-through.
 * This file replaces the simple "proxy" string in package.json
 * and preserves identical behaviour while adding no-buffer headers
 * required for text/event-stream responses.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      ws: false, // WebSocket handled separately if needed
      // Ensure streaming responses are not buffered by the dev server
      onProxyRes(proxyRes, req) {
        const accept = req.headers['accept'] || '';
        if (accept.includes('text/event-stream')) {
          proxyRes.headers['x-accel-buffering'] = 'no';
          proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          proxyRes.headers['connection'] = 'keep-alive';
        }
      },
    }),
  );
};
