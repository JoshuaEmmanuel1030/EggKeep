// Rules for editing a recorded order ("Edit order" in Activities). The server
// (public.correct_order) enforces the same rules; these drive the UI.

// Orders can be edited for this long after they were FIRST entered. An edit
// keeps the original created_at, so editing never restarts the clock.
export const EDIT_WINDOW_MINUTES = 60;

// Whole minutes left in the edit window (0 when closed).
export function editMinutesLeft(createdAt: string, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - new Date(createdAt).getTime();
  const leftMs = EDIT_WINDOW_MINUTES * 60_000 - elapsedMs;
  return leftMs > 0 ? Math.ceil(leftMs / 60_000) : 0;
}

// An original row that an edit replaced (voided and linked to its correction).
// Hidden from the feed except under the Voided tab.
export function isSuperseded(log: { voided_at?: string | null; corrected_by_log_id?: string | null }): boolean {
  return !!log.voided_at && !!log.corrected_by_log_id;
}

export function canCorrect(params: {
  createdAt: string;
  entryUserId?: string;
  currentUserId?: string;
  isAdmin: boolean;
  voided: boolean;
  synced: boolean; // still in the offline queue -> not in the database yet
  hasReturns: boolean;
  now?: Date;
}): boolean {
  const { createdAt, entryUserId, currentUserId, isAdmin, voided, synced, hasReturns, now } = params;
  if (voided || !synced || hasReturns) return false;
  if (!isAdmin && (!currentUserId || currentUserId !== entryUserId)) return false;
  return editMinutesLeft(createdAt, now) > 0;
}

export type CorrectionError =
  | "INSUFFICIENT_STOCK"
  | "EDIT_WINDOW_CLOSED"
  | "HAS_RETURNS"
  | "ALREADY_CHANGED"
  | "NOT_ALLOWED"
  | "ORDER_INCOMPLETE"
  | "NETWORK"
  | "OTHER";

// Map a correct_order failure message to a code the dialog can explain.
export function correctionErrorCode(message: string | undefined, online = true): CorrectionError {
  const m = message ?? "";
  for (const code of ["INSUFFICIENT_STOCK", "EDIT_WINDOW_CLOSED", "HAS_RETURNS", "ALREADY_CHANGED", "NOT_ALLOWED", "ORDER_INCOMPLETE"] as const) {
    if (m.includes(code)) return code;
  }
  if (!online || /Failed to fetch|NetworkError|network/i.test(m)) return "NETWORK";
  return "OTHER";
}
