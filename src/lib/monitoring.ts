import * as Sentry from "@sentry/react";

// Sentry is only active when VITE_SENTRY_DSN is set (Vercel env var).
// Without a DSN every function here is a no-op, so local dev and builds
// stay clean until the owner creates the Sentry project.
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function isMonitoringEnabled(): boolean {
  return Boolean(DSN);
}

/** Initialize Sentry. Must be called before React renders. No-op without a DSN. */
export function initMonitoring(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    // Vercel exposes the commit SHA when "Automatically expose System
    // Environment Variables" is on; undefined is fine otherwise.
    release: (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) || undefined,
    integrations: [Sentry.browserTracingIntegration()],
    // Tiny app, ~3 users: 10% of transactions is plenty for perf signal
    // and keeps us far inside the free-tier quota.
    tracesSampleRate: 0.1,
  });
}

/**
 * Report a caught error to Sentry with optional context (e.g. which RPC
 * failed and with what payload shape). No-op without a DSN — callers never
 * need to check. Never throws.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!DSN) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Monitoring must never break the app.
  }
}
