import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { devLogPlugin } from './tools/vite-plugin-dev-log';

export default defineConfig({
  plugins: [
    react(),
    devLogPlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        name: 'SplitTicket — répartition de tickets de caisse',
        short_name: 'SplitTicket',
        description:
          'Photographier un ticket de caisse, corriger les lignes, répartir les montants entre plusieurs personnes — taxes et pourboire compris.',
        lang: 'fr-CA',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FAFAF9',
        theme_color: '#FAFAF9',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        /* Without this exclusion, the service worker would answer "index.html"
           to an API request and the application would receive HTML where it
           expects JSON. API responses are not cached here either: the read
           cache is held by the application, which knows what may go stale and
           what may not. */
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
  },
  server: {
    /* The application calls "/api"; in development we proxy that to the local
       API. Same origin as in production: the code does not have to know whether
       it is running in development. */
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        /* The proxy's point of view is the only one that tells "the API
           answered an error" from "the API is not there": from the browser, the
           two look alike. It is almost always the second. */
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(`  → api  ${req.method} ${req.url}`);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            const status = proxyRes.statusCode ?? 0;
            const mark = status >= 500 ? '!!' : status >= 400 ? ' !' : '  ';
            console.log(`${mark}← api  ${req.method} ${req.url} → ${status}`);
          });
          proxy.on('error', (error, req) => {
            console.log(`!! api  ${req.method} ${req.url} — unreachable: ${error.message}`);
            console.log('        is the API running on http://localhost:8787 ?');
          });
        },
      },
    },
  },
});
