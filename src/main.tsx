import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadSegmentFont } from './components/visuals/segments';
import { isNative } from './platform';
import { settingsStore } from './state/store';
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

/*
 * Unlocks the paid tier while developing.
 *
 *   ?dev       every paid feature open
 *   ?dev=off   locked again, as a first-time user sees it
 *
 * `?shots` already did this, but it also replaces the microphone with a
 * synthetic note, which is right for photographing the app and wrong for using
 * it. This is the entitlement on its own and nothing else.
 *
 * **It sticks.** `owned` is a stored setting like any other and survives
 * leaving this URL, so a plain `/` afterwards keeps whichever answer was set
 * last. That has already caused one round of "why is everything unlocked",
 * which is why it says so on the way in and why the way back out is one word.
 *
 * Inline rather than a module of its own: it is one call, and the DEV guard
 * means a production build drops the branch entirely.
 */
if (import.meta.env.DEV) {
  const dev = new URLSearchParams(location.search).get('dev');
  if (dev !== null) {
    const owned = dev !== 'off';
    settingsStore.set({ owned });
    // eslint-disable-next-line no-console
    console.log(
      `[dev] full set ${owned ? 'unlocked' : 'locked'}. This is stored and sticks; ` +
        `use ?dev=${owned ? 'off' : ''} to put it back.`,
    );
  }
}

/*
 * The screenshot *framing* rig, which is a different thing from the one below:
 * it sizes the app to Apple's pixel counts and saves PNGs of it. Same stored
 * sticky flag as the rest, for the same reason.
 */
if (import.meta.env.DEV) {
  const screens = new URLSearchParams(location.search).get('screens');
  if (screens !== null) {
    try {
      if (screens === 'off') localStorage.removeItem('easyastuning.screens');
      else localStorage.setItem('easyastuning.screens', '1');
    } catch {
      /* private mode — the rig still works, it just won't be remembered */
    }
    /*
     * And everything open, because every screenshot is of the paid app.
     *
     * Not a separate decision from framing it: the point of the rig is to
     * photograph what the store is selling, and half the features being
     * behind a lock would make that impossible without a second flag to
     * remember to set. `?shots` has always done the same. It sticks, like
     * every other entitlement written here.
     */
    if (screens !== 'off') settingsStore.set({ owned: true });
  }
}

/*
 * The App Store screenshot rig, which hands the tuner a synthetic instrument
 * so the pictures have a note in them. Imported dynamically inside a DEV
 * guard, so a production build drops the branch and never emits the chunk.
 */
if (import.meta.env.DEV && new URLSearchParams(location.search).has('shots')) {
  void import('./shots').then((m) => m.installScreenshotRig());
}

/*
 * The app icon designer. Unlike the screenshot rig this one *replaces* the
 * app rather than driving it — it needs the stylesheet's colours and nothing
 * else, and an icon is not a screen the tuner can be photographed on.
 */
if (import.meta.env.DEV && new URLSearchParams(location.search).has('icon')) {
  void import('./icon').then((m) => m.installIconRig());
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/**
 * A LAN address means this is the `npm run phone` server, being looked at from
 * a handset on the same Wi-Fi.
 *
 * A service worker there has nothing to offer and a great deal to cost: the
 * whole point of it is to keep the *shipped* app working without a signal,
 * and on a testing server all it does is serve the previous build back to you
 * while you wonder why your change did not land. That has now happened twice,
 * once with another project's worker squatting on the same port and once with
 * this app's own.
 */
const onTestServer = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);

/*
 * And a worker inside the packaged app is worse than useless.
 *
 * Its whole job is to keep a *web* app working with no signal. In the App
 * Store build every file it would cache is already on the device, so it buys
 * nothing — and it brings the one failure this project has now hit three
 * times: a cached copy of the previous build served over the new one. In a
 * browser the answer to that is to clear site data. In a shipped app there is
 * no such instruction to give, and an update that visibly does not arrive is
 * a one-star review.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD && !onTestServer && !isNative()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      // updateViaCache 'none' stops the browser answering the update check out
      // of its own HTTP cache, which is how a worker goes stale and stays that
      // way. The explicit update() asks on every launch rather than whenever
      // the browser feels like it.
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((reg) => {
        void reg.update();

        // A worker that takes over mid-session leaves the page running the
        // code the *old* one served. Only reload if something was already in
        // charge — on a first install there is nothing to replace.
        if (!navigator.serviceWorker.controller) return;
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      })
      .catch(() => {
        /* offline support is a bonus, not a requirement */
      });
  });
}

/*
 * And clean up after the versions that did register one here.
 *
 * Without this, a handset that has already been pointed at the test server
 * keeps its old worker for good: the code above simply stops registering, and
 * the thing already installed carries on answering every request from a cache
 * nothing will ever invalidate. This tears it out on the next load, which is
 * the only way the fix reaches a phone that is already in that state.
 */
if ('serviceWorker' in navigator && onTestServer) {
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return;
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    location.reload();
  });
}
