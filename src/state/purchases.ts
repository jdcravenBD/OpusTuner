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
 * answers this on-device with no server and no third party, which is both the
 * right engineering answer for a single non-consumable and the only one
 * consistent with what docs/privacy.html promises. See `nativeStore` for the
 * shape the adapter has to fill.
 *
 * ## Enforcement
 *
 * There is none, and there cannot be. `owned` lives in localStorage and anyone
 * who wants to edit it can. Verifying it properly means a server, and this app
 * does not have one and should not get one. What this module buys is that the
 * *honest* path works: people who pay get their thing, on every device, for
 * good.
 */

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

/**
 * The packaged app's store.
 *
 * Not built yet, and deliberately not faked: an adapter that pretends to
 * succeed would unlock the paid tier for everyone the moment it shipped. Until
 * a StoreKit 2 bridge exists this reports honestly that there is no store, and
 * the purchase screen says so rather than spinning.
 *
 * Whatever fills this in needs four things from StoreKit 2, all of them
 * on-device:
 *
 *   entitled()  Transaction.currentEntitlements, looking for PRODUCT_ID with a
 *               verified signature. This is what makes a reinstall work.
 *   price()     Product.products(for:) -> displayPrice, which is localised and
 *               correct for the store the user is actually in. PRICE in
 *               unlock.ts is only a fallback for when it cannot be reached.
 *   buy()       product.purchase(), then finish() the transaction. A
 *               .userCancelled result is `cancelled`, not `failed`.
 *   restore()   AppStore.sync(), then entitled() again.
 */
const nativeStore: Store = {
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
