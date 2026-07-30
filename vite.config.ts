import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * `npm run dev`  -> http://localhost:5173 (localhost counts as a secure
 *                   context, so the microphone works without certificates)
 * `npm run host` -> https://<your-lan-ip>:5173 with a self-signed certificate,
 *                   which is what phones need before they will hand over a mic
 */
export default defineConfig(({ mode }) => ({
  // Relative asset paths: required for Capacitor's WebView, and lets the built
  // site be served from a subdirectory without rebuilding.
  base: './',

  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],

  server: {
    port: 5173,
    strictPort: false,
  },

  build: {
    target: ['es2020', 'safari14', 'chrome87', 'firefox78'],
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
}));
