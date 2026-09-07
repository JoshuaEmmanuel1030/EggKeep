/**
 * Bridge between the service-worker registration (set up in main.tsx, outside
 * the React tree) and an in-app "refresh" button. Warehouse iPhones run the app
 * from the home screen, where iOS throttles automatic service-worker updates —
 * so staff need a way to pull the latest build on demand without knowing the
 * force-quit gesture.
 */

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

let updateSW: UpdateSW | null = null;
let registration: ServiceWorkerRegistration | undefined;

/** Called once from main.tsx after the service worker registers. */
export function setPwaUpdater(fn: UpdateSW, reg?: ServiceWorkerRegistration): void {
  updateSW = fn;
  registration = reg;
}

/**
 * Check the server for a newer build and load it:
 *  - a new worker is waiting        → activate it (skip waiting) and reload
 *  - a new worker is still installing → wait for it, then activate and reload
 *  - already up to date             → plain reload (so the button always does
 *                                      something visible, and clears stale UI)
 *
 * updateSW(true) is the vite-plugin-pwa helper: it posts SKIP_WAITING to the
 * waiting worker and reloads on controllerchange. The generated sw.js carries
 * the matching SKIP_WAITING handler.
 */
export async function refreshApp(): Promise<void> {
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration());

  try {
    await reg?.update();
  } catch {
    // Offline or the check failed — fall through to a plain reload below.
  }

  if (reg?.waiting && updateSW) {
    await updateSW(true);
    return;
  }

  const installing = reg?.installing;
  if (installing && updateSW) {
    installing.addEventListener("statechange", () => {
      // Once installed it becomes the waiting worker, so updateSW can apply it.
      if (installing.state === "installed") updateSW!(true);
    });
    return;
  }

  window.location.reload();
}
