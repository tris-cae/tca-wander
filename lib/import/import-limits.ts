// ─── Bulk import allowance ────────────────────────────────────────────────────
//
// Each device gets a small number of bulk imports while Notice is in beta.
// Typed entry and screenshot import draw on the same count — one import is one
// import regardless of how the names arrived.
//
// IMPORTANT, AND BY DESIGN: this count lives on the device, so it is a speed
// bump rather than a lock. See `bypassNotes` below for exactly how it can be
// reset. Enforcing it properly needs accounts, which is Build 3. The Worker's
// per-device daily search limit is the real backstop against runaway cost.
//
// Saving places one at a time is never limited.

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bulk imports allowed per device during beta. */
export const BULK_IMPORT_ALLOWANCE = 2;

/** Most places one import may contain. */
export const MAX_IMPORT_SIZE = 20;

/** Most screenshots that may be read in one go. */
export const MAX_SCREENSHOTS = 5;

const KEY = '@import/bulkImportsUsed';

/**
 * Plain-language account of how this limit can be got around before accounts
 * exist. Kept in code so it does not drift out of the README.
 */
export const bypassNotes = [
  'Deleting and reinstalling the app clears the count, because it lives in the ' +
  'app\'s own storage and goes with it.',
  'Erasing the app\'s data from iOS Settings has the same effect.',
  'A second device gets its own fresh count — the limit is per device, not per person.',
  'Restoring an older device backup can roll the count back.',
] as const;

/** How many bulk imports this device has used. */
export async function getImportsUsed(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    // Storage unavailable — fail open rather than locking a user out of a
    // feature because a read failed.
    return 0;
  }
}

/** How many are left. Never negative. */
export async function getImportsRemaining(): Promise<number> {
  return Math.max(0, BULK_IMPORT_ALLOWANCE - (await getImportsUsed()));
}

/** True when this device may start another bulk import. */
export async function canImport(): Promise<boolean> {
  return (await getImportsRemaining()) > 0;
}

/**
 * Records that an import completed.
 *
 * Called only after places were actually written — a search that found nothing,
 * or an import the user abandoned at the review screen, does not spend an
 * allowance.
 */
export async function recordImportUsed(): Promise<void> {
  try {
    const used = await getImportsUsed();
    await AsyncStorage.setItem(KEY, String(used + 1));
  } catch {
    // If we cannot record it, the user gets an extra import. That is the right
    // way round to fail.
  }
}

/** Test and support hook — not reachable from the UI. */
export async function resetImportsUsed(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to do */ }
}
