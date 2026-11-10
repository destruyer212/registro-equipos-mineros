import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pwa = {
  name: 'minacontrol-service-worker',
  apply: 'build',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const files = [
        '/', '/mina.svg', '/hero-machine.svg', '/manifest.webmanifest',
        '/icons/app-192.png', '/icons/app-512.png', '/icons/maskable-512.png',
        ...Object.keys(bundle).filter((file) => file.startsWith('assets/')).map((file) => `/${file}`),
      ];
      const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: worker.replace('__PRECACHE__', JSON.stringify({ version: randomUUID(), files })),
      });
    },
  },
};

export default defineConfig({ plugins: [react(), pwa] });
