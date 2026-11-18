import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const brand = env.VITE_BRAND_NAME || 'Subscription Portal';
  if (!/^[\p{L}\p{N} ._-]{1,48}$/u.test(brand)) throw Error('Invalid VITE_BRAND_NAME');
  const render = text => text.replaceAll('Service Portal', brand);
  const templates = new Map(readdirSync('templates').map(name =>
    [name, render(readFileSync('templates/' + name, 'utf8'))]));
  const branding = {
    name: 'portal-branding', enforce: 'pre',
    transform(source, id) {
      if (/[/\\]src[/\\].*\.jsx?$/.test(id) && source.includes('Service Portal')) return render(source);
    },
    transformIndexHtml: { order: 'pre', handler: render },
    generateBundle() {
      for (const [fileName, source] of templates) this.emitFile({ type: 'asset', fileName, source });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url.split('?')[0].slice(1);
        if (!templates.has(name)) return next();
        const mime = name.endsWith('.js') ? 'application/javascript' : name.endsWith('.html') ? 'text/html' : 'application/manifest+json';
        res.setHeader('Content-Type', mime + '; charset=utf-8');
        res.end(templates.get(name));
      });
    },
  };
  return { plugins: [branding, react()], server: { host: '127.0.0.1', proxy: {
    '/api': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3004', changeOrigin: true, secure: true }
  } } };
});
