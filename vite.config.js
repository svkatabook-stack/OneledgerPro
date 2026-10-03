import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['oneledger.svg'],
      manifest: {
        name: 'OneLedger Pro',
        short_name: 'OneLedger',
        description: 'Customer cash, gold, silver and chit ledger',
        theme_color: '#0f172a',
        background_color: '#070c18',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'oneledger.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
});
