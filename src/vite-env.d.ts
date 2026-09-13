/// <reference types="vite/client" />

/** Build timestamp, injected by vite.config.ts. Shown in About. */
declare const __BUILD_ID__: string;

/** package.json's version, injected by vite.config.ts. The only copy. */
declare const __APP_VERSION__: string;

/**
 * A word naming the build, shown in the corner. Non-empty only in
 * `npm run phone`; '' everywhere a customer could see it.
 */
declare const __BUILD_WORD__: string;

/**
 * True only in `npm run phone` — the LAN test build. False in `npm run build`,
 * which is what ships, so anything guarded on it is dropped from the bundle.
 */
declare const __PHONE_BUILD__: boolean;
