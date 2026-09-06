import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
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
        /* Sans cette exclusion, le service worker répondrait « index.html » à
           une requête d'API et l'application recevrait du HTML là où elle
           attend du JSON. Les réponses d'API ne sont pas non plus mises en
           cache ici : le cache de lecture est tenu par l'application, qui sait
           ce qui peut vieillir et ce qui ne le peut pas. */
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
    /* L'application appelle « /api » ; en développement, on le mandate vers
       l'API locale. Même origine qu'en production : le code n'a pas à savoir
       s'il tourne en développement. */
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
