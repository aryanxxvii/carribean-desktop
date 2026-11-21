import { defineConfig } from 'vite';
import { createService } from './core/service.mjs';

function localLibrary() {
  return {
    name: 'carribean-local-library',
    configureServer(server) {
      const service = createService();
      const ready = service.start();
      server.httpServer?.once('close', () => service.stop());
      server.middlewares.use('/api/library', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        const { host, origin } = request.headers;
        const port = request.socket.localPort;
        if (request.method !== 'POST' || !['127.0.0.1:' + port, 'localhost:' + port].includes(host)
            || origin !== 'http://' + host || request.headers['x-carribean'] !== 'local') {
          response.writeHead(403).end(JSON.stringify({ error: 'Open Caribbean from its localhost preview.' }));
          return;
        }
        try {
          const buffers = [];
          let bytes = 0;
          for await (const chunk of request) {
            if ((bytes += chunk.length) > 16 * 1024 * 1024) {
              response.writeHead(413).end(JSON.stringify({ error: 'The import is larger than 16 MB.' }));
              return;
            }
            buffers.push(chunk);
          }
          await ready;
          const { action, payload } = JSON.parse(Buffer.concat(buffers).toString('utf8'));
          response.end(JSON.stringify(await service.action(action, payload)));
        } catch (error) {
          response.writeHead(400).end(JSON.stringify({ error: error.message }));
        }
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [localLibrary()],
  css: { transformer: 'postcss' },
  oxc: { jsx: { runtime: 'automatic' } }
});
