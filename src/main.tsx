import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { initMonitoring } from "./lib/monitoring.ts";
import "./index.css";

// Error monitoring must start before React renders so render-time crashes
// are captured. No-op unless VITE_SENTRY_DSN is set.
initMonitoring();

// Register service worker with update prompt
const updateSW = registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
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
    updateSW(true);
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
