/**
 * Buying the full set, and finding out you already have.
 *
 * Everything the app knows about money goes through the `Store` interface
 * below. There is exactly one implementation that matters — the platform's —
 * and the rest of the app never learns which one it got. `unlock.ts` decides
 * *what* is paid for; this decides whether it has been.
 *
 * ## The question that shapes all of this
 *
 * A non-consumable is not a flag you flip once. It is something Apple's
 * account owns forever, and the app has to be able to *ask*: new phone, wiped
 * device, restored backup, app deleted and reinstalled a year later. Apple
 * requires an answer to that and rejects apps without one (review guideline
 * 3.1.1). So `entitled()` is the load-bearing method here, not `buy()` —
 * buying is a one-off, asking happens on every launch.
 *
 * That requirement is also what ruled a plugin out. @capgo/native-purchases
 * was installed, read and removed: its `restorePurchases()` returns void and
 * it exposes no way to query current entitlements at all, so a reinstall could
 * never get its purchase back. StoreKit 2's `Transaction.currentEntitlements`
 * answers it on-device with no server and no third party, which is both the
 * right answer for a single non-consumable and the only one consistent with
 * what docs/privacy.html promises — so the bridge is ours:
 * ios/App/App/FullSetStorePlugin.swift, about a hundred lines of Swift.
 *
 * ## Enforcement
 *
 * There is none, and there cannot be. `owned` lives in localStorage and anyone
 * who wants to edit it can. Verifying it properly means a server, and this app
 * does not have one and should not get one. What this module buys is that the
 * *honest* path works: people who pay get their thing, on every device, for
 * good.
 */

import { registerPlugin } from '@capacitor/core';

import { isNative } from '../platform';
import { settingsStore } from './store';

/**
 * The App Store product. Must match the identifier created in App Store
 * Connect exactly, and cannot be changed afterwards without becoming a
 * different product that nobody owns.
 */
export const PRODUCT_ID = 'com.easyastuning.app.fullset';

/** What came of a purchase or a restore, in terms the screen can print. */
export type Outcome =
  | 'owned'
  /* The user backed out. Not an error, and must not be reported as one. */
  | 'cancelled'
  /* Asked to restore, and there was nothing on the account to restore. */
  | 'nothing-to-restore'
  /* Ask to Buy: a child asked, and a parent has not answered yet. Neither
     bought nor refused, and it arrives later on its own. */
  | 'pending'
  /* No store here at all — a browser, or the packaged app before the
     native adapter exists. */
  | 'unavailable'
  | 'failed';

export interface Store {
  /**
   * What this Apple ID already owns. Called on launch, so it must be cheap and
   * must never throw — an unreachable store is `false`, not a crash.
   */
  entitled(): Promise<boolean>;
  /** The store's own localised price, or null if it could not be asked. */
  price(): Promise<string | null>;
  buy(): Promise<Outcome>;
  restore(): Promise<Outcome>;
}

/** The Swift half, in ios/App/App/FullSetStorePlugin.swift. */
interface FullSetStorePlugin {
  entitled(options: { productId: string }): Promise<{ entitled: boolean }>;
  /** `price` is absent, not null, when the store could not be asked. */
  price(options: { productId: string }): Promise<{ price?: string }>;
  /** `message` carries the reason whenever the outcome is not a plain yes. */
  buy(options: { productId: string }): Promise<{ outcome: Outcome; message?: string }>;
  restore(options: { productId: string }): Promise<{ outcome: Outcome; message?: string }>;
}

/*
 * Safe to call at module scope in a browser: with no native bridge behind it
 * this is a proxy that rejects when a method is called, and nothing calls one
 * unless isNative() said so.
 */
const FullSetStore = registerPlugin<FullSetStorePlugin>('FullSetStore');

/**
 * The packaged app's store: StoreKit 2, straight through.
 *
 * Every method swallows its own failures, because every one of them has an
 * `Outcome` that says so and the screen has copy for each. The one that must
 * never throw is `entitled()` — it runs on launch, and an exception there
 * would take the app down before it drew anything.
 */
/**
 * Why the last purchase or restore did not work.
 *
 * Module state rather than part of the return, deliberately. Every caller
 * wants the `Outcome` and only the screen wants this, and threading a second
 * value through four signatures to reach one label is a worse shape than a
 * variable that says what it is.
 *
 * It exists because a TestFlight build on a handset has no console. Without
 * it, StoreKit refusing for one reason and the plugin failing to register at
 * all are the same five words on screen, and there is no way to tell them
 * apart from the outside.
 */
let lastFailure: string | null = null;

export function lastPurchaseFailure(): string | null {
  return lastFailure;
}

const nativeStore: Store = {
  async entitled() {
    try {
      return (await FullSetStore.entitled({ productId: PRODUCT_ID })).entitled;
    } catch {
      return false;
    }
  },
  async price() {
    try {
      return (await FullSetStore.price({ productId: PRODUCT_ID })).price ?? null;
    } catch {
      return null;
    }
  },
  async buy() {
    try {
      const { outcome, message } = await FullSetStore.buy({ productId: PRODUCT_ID });
      lastFailure = outcome === 'owned' ? null : (message ?? null);
      return outcome;
    } catch (err) {
      // A plugin that never registered rejects here rather than resolving,
      // and its message says so. That is worth telling apart from StoreKit
      // declining, which looks identical from the button.
      lastFailure = String(err);
      return 'failed';
    }
  },
  async restore() {
    try {
      const { outcome, message } = await FullSetStore.restore({ productId: PRODUCT_ID });
      lastFailure = outcome === 'owned' ? null : (message ?? null);
      return outcome;
    } catch (err) {
      lastFailure = String(err);
      return 'failed';
    }
  },
};

/**
 * The browser's store, which is that there isn't one.
 *
 * The web build is a real thing people use, and it has no way to take money.
 * Saying so plainly is better than hiding the button: the reader can see what
 * the full set is and go and get the app.
 */
const webStore: Store = {
  async entitled() {
    return false;
  },
  async price() {
    return null;
  },
  async buy() {
    return 'unavailable';
  },
  async restore() {
    return 'unavailable';
  },
};

/**
 * A store that says yes, for developing against.
 *
 * Behind `?mockstore` and compiled out of production entirely, because a
 * query string that unlocks the paid tier is not something to ship even in an
 * app whose flag is already editable. It is how the buy-restore-relaunch path
 * gets exercised without an Apple account.
 */
function mockStore(): Store {
  let held = false;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    async entitled() {
      return held;
    },
    async price() {
      await wait(120);
      return '$1.99';
    },
    async buy() {
      await wait(700);
      held = true;
      return 'owned';
    },
    async restore() {
      await wait(500);
      return held ? 'owned' : 'nothing-to-restore';
    },
  };
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const mocked = (() => {
    try {
      return import.meta.env.DEV && new URLSearchParams(location.search).has('mockstore');
    } catch {
      return false;
    }
  })();
  store = mocked ? mockStore() : isNative() ? nativeStore : webStore;
  return store;
}

/**
 * Ask the platform what is owned and write it down.
 *
 * Called at launch and after a restore. It only ever turns `owned` *on*: a
 * store that cannot be reached, on a plane or with the App Store having a bad
 * afternoon, must not take away something already paid for. Losing the tier
 * because of a network blip is a far worse failure than a stale true.
 */
export async function reconcileEntitlement(): Promise<void> {
  try {
    if (await getStore().entitled()) settingsStore.set({ owned: true });
  } catch {
    /* the store is allowed to be unreachable; see above */
  }
}

/** Buys it, and records the result if it worked. */
export async function buyFullSet(): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await getStore().buy();
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'owned') settingsStore.set({ owned: true });
  return outcome;
}

/** Asks Apple for a purchase made on some other device, or before a wipe. */
export async function restoreFullSet(): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await getStore().restore();
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'owned') settingsStore.set({ owned: true });
  return outcome;
}
