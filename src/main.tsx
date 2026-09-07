import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { initMonitoring } from "./lib/monitoring.ts";
import { toast } from "./hooks/use-toast.ts";
import { ToastAction } from "./components/ui/toast.tsx";
import { setPwaUpdater } from "./lib/pwaUpdate.ts";
import { en } from "./locales/en.ts";
import { id } from "./locales/id.ts";
import "./index.css";

// Error monitoring must start before React renders so render-time crashes
// are captured. No-op unless VITE_SENTRY_DSN is set.
initMonitoring();

// Update strings in the user's chosen language. main.tsx lives outside the React
// tree / LanguageContext, so read the persisted language directly (same key as
// LanguageContext) and fall back to English.
function updateStrings() {
  return (localStorage.getItem("js-online-language") === "id" ? id : en).update;
}

// Register service worker in 'prompt' mode: a new build is NEVER applied
// silently — we surface a one-tap toast instead (iOS home-screen PWAs throttle
// silent auto-reload, and a surprise mid-entry reload can lose a half-typed order).
const updateSW = registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Expose the updater to the in-app "refresh" button (Header).
    setPwaUpdater(updateSW, registration);
    // A long-lived PWA session only checks for a new bundle ~hourly. Data entered
    // by a stale bundle can be format-incompatible (e.g. the kg-native cutover),
    // so also check on every focus/visibility regain and every 15 minutes.
    const check = () => registration.update().catch(() => {});
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    setInterval(check, 15 * 60 * 1000);
  },
  onNeedRefresh() {
    const s = updateStrings();
    toast({
      title: s.title,
      description: s.description,
      duration: 1000000, // persist until the user taps Refresh (no auto-dismiss)
      action: (
        <ToastAction altText={s.action} onClick={() => updateSW(true)}>
          {s.action}
        </ToastAction>
      ),
    });
  },
  onOfflineReady() {
    console.log("App ready for offline use");
  },
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
