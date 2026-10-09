// ─── First-open state ─────────────────────────────────────────────────────────
//
// One flag: has this install seen the welcome screen.
//
// The flag starts unset for everyone, which means existing beta testers see the
// welcome once on their next launch. That is deliberate — they are the people
// who reported not knowing what to do on first open.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@onboarding/seen';

/**
 * Whether the welcome still needs showing.
 *
 * Returns false on a storage error: a failed read should never trap someone on
 * a welcome screen they have already dismissed.
 */
export async function shouldShowOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === null;
  } catch {
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // Worst case the welcome appears again next launch, which is recoverable
  }
}

/** Test and support hook — not reachable from the UI. */
export async function resetOnboarding(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to do */ }
}
