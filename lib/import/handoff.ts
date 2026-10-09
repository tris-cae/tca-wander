// ─── Passing review rows between screens ──────────────────────────────────────
//
// Twenty rows, each carrying every candidate the search returned, is far too
// much to push through route params — Expo Router serialises those into the
// URL. This is a one-slot in-memory handover instead: the lookup screen puts
// the rows in, the review screen takes them out.
//
// Deliberately not a store or a context. It holds exactly one import, it is
// cleared when read, and nothing subscribes to it.

import type { ReviewRow } from './types';

export interface ImportHandoff {
  rows: ReviewRow[];
  /** The city or trip the user chose, applied as the category on save. */
  cityLabel: string;
}

let slot: ImportHandoff | null = null;

export const importHandoff = {
  set(value: ImportHandoff): void {
    slot = value;
  },

  /**
   * Returns the pending import and clears the slot, so a back-navigation
   * cannot resurrect a stale set of rows.
   */
  take(): ImportHandoff | null {
    const value = slot;
    slot = null;
    return value;
  },

  clear(): void {
    slot = null;
  },
};
