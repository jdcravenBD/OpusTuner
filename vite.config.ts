import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * Writes the built asset filenames into the service worker's precache list.
 *
 * They are content-hashed, so the worker cannot name them itself, and without
 * them the app only survives losing its connection from the *second* visit
 * onwards — see the comment on PRECACHE in public/sw.js.
 *
 * Source maps are deliberately left out: a megabyte of them is no use to
 * someone tuning a guitar in a room with no signal.
 */
function precacheServiceWorker(): Plugin {
  return {
    name: 'precache-sw',
    apply: 'build',
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const outDir = resolve('dist');
        const swPath = join(outDir, 'sw.js');

        const walk = (dir: string, base = ''): string[] =>
          readdirSync(dir).flatMap((entry) => {
            const full = join(dir, entry);
            const rel = base ? posix.join(base, entry) : entry;
            return statSync(full).isDirectory() ? walk(full, rel) : [rel];
          });

        let assets: string[];
        try {
          assets = walk(outDir).filter(
            (f) =>
              (f.startsWith('assets/') || f.startsWith('icons/')) && !f.endsWith('.map'),
          );
        } catch {
          return; // no dist to annotate
        }

        const list = assets.map((f) => `  './${f}',`).join('\n');
        const sw = readFileSync(swPath, 'utf8');
        writeFileSync(swPath, sw.replace('  /* BUILD_ASSETS */', list), 'utf8');
        this.info(`precached ${assets.length} assets into sw.js`);
      },
    },
  };
}

/**
 * `npm run dev`      -> http://localhost:5440. localhost counts as a secure
 *                       context, so the microphone works without certificates.
 * `npm run phone`    -> builds, then serves the *built* app over HTTPS on your
 *                       LAN at :4440. This is the one to point a phone at.
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

  plugins: [react(), precacheServiceWorker(), ...(mode === 'https' ? [basicSsl()] : [])],

  /*
   * Ports of our own, and no wandering off them.
   *
   * A browser keys service workers, caches, localStorage and IndexedDB by
   * *origin* — scheme, host and port, nothing else. Two Vite projects on their
   * default ports, reached over the LAN at the same address, are therefore the
   * same origin as far as a phone is concerned, and they share all of it. The
   * app that registered a service worker last owns the origin and answers the
   * navigation, so opening this one served the other project's app instead of
   * the tuner — and it cannot right itself, because this app's page never runs
   * to register anything of its own.
   *
   * 440 for the A. Nothing else has a claim on either number.
   *
   * strictPort because the alternative is worse than a failure: with a port
   * already taken, Vite quietly moves to the next one and prints an address
   * that belongs to whatever it landed next to. Better to stop and say so.
   */
  server: {
    port: 5440,
    strictPort: true,
  },

  preview: {
    port: 4440,
    strictPort: true,
  },

  build: {
    target: ['es2020', 'safari14', 'chrome87', 'firefox78'],
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
}));
