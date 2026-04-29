// ─── App Settings ─────────────────────────────────────────────────────────────
//
// Thin AsyncStorage wrapper for user-configurable preferences.
// All reads return a default if the key has never been written.
// All writes are fire-and-forget — callers can await if needed.

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Storage keys ──────────────────────────────────────────────────────────────

const K = {
  notificationsEnabled: '@settings/notificationsEnabled',
  notificationRadius:   '@settings/notificationRadiusMetres',
} as const;

// ── Defaults ──────────────────────────────────────────────────────────────────

/** 300 m — close enough to be actionable, far enough not to be spammy. */
export const DEFAULT_RADIUS_M  = 300;
/** Proximity alerts are ON until the user explicitly disables them. */
export const DEFAULT_ENABLED   = true;

// ── Proximity notifications enabled / disabled ────────────────────────────────

export async function getNotificationsEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(K.notificationsEnabled);
  return raw === null ? DEFAULT_ENABLED : raw === 'true';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(K.notificationsEnabled, String(enabled));
}

// ── Notification radius (metres) ──────────────────────────────────────────────

export async function getNotificationRadius(): Promise<number> {
  const raw = await AsyncStorage.getItem(K.notificationRadius);
  if (raw === null) return DEFAULT_RADIUS_M;
  const n = parseInt(raw, 10);
  return isNaN(n) ? DEFAULT_RADIUS_M : n;
}

export async function setNotificationRadius(metres: number): Promise<void> {
  await AsyncStorage.setItem(K.notificationRadius, String(Math.round(metres)));
}
