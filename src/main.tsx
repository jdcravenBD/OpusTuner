import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadSegmentFont } from './components/visuals/segments';
import { tuner } from './tuner/TunerController';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// Fetched at startup rather than when the strobe first opens. Otherwise someone
// who has only ever used the field screen never pulls the file down, the
// service worker therefore never caches it, and the first time they page across
// to the strobe with no signal its readout has nothing to draw with.
loadSegmentFont();

// Handy from the console while developing: __tuner.frame, __tuner.engine, …
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__tuner = tuner;

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. Skipped in dev so the service worker never serves a stale
// module graph over the top of Vite's HMR.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  });
}
