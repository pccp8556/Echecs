import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import securityHeaders from './deploy/security-headers.json' with { type: 'json' };

// Mode « artifact » : préversion hébergée sur claude.ai (chemins relatifs, sans service worker).
export default defineConfig(({ mode }) => ({
  base: mode === 'artifact' ? './' : '/',
  define: { 'import.meta.env.VITE_PREVIEW_HOST': JSON.stringify(mode === 'artifact' ? 'artifact' : '') },
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'artifact',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        name: 'Paul aurait trouvé — Révision d’ouvertures',
        short_name: 'Paul',
        description: 'Révise tes ouvertures d’échecs à partir de tes propres fichiers PGN.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0f14',
        theme_color: '#0a0f14',
        categories: ['education', 'games'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico,webmanifest}'],
        // Seules les polices latines sont préchargées ; Stockfish est mis en cache à la première utilisation.
        globIgnores: ['**/stockfish/**', '**/*vietnamese*', '**/*cyrillic*', '**/*greek*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/stockfish\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/stockfish/'),
            handler: 'CacheFirst',
            options: { cacheName: 'stockfish-18', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
  },
  server: { port: 5173, strictPort: true },
  // Mêmes en-têtes que Netlify : les tests E2E vérifient que la CSP n'empêche rien.
  preview: { port: 4173, strictPort: true, headers: securityHeaders },
}));
