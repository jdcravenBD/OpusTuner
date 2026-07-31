import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * `npm run dev`      -> http://localhost:5173. localhost counts as a secure
 *                       context, so the microphone works without certificates.
 * `npm run phone`    -> builds, then serves the *built* app over HTTPS on your
 *                       LAN. This is the one to point a phone at.
 * `npm run host`     -> the dev server on your LAN. Rarely what you want on a
 *                       phone: dev mode ships every source file as its own
 *                       module request, which is hundreds of them over a
 *                       self-signed certificate, and Safari tends to stall
 *                       partway and leave you a white screen. A build is one
 *                       script and one stylesheet.
 *
 * For anything more than a quick check, push to main instead and let the Pages
 * workflow publish it — a real certificate, and reachable off your network.
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

  preview: {
    port: 4173,
    strictPort: false,
  },

  build: {
    target: ['es2020', 'safari14', 'chrome87', 'firefox78'],
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
}));
