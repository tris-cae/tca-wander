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
  useFeet:              '@settings/useFeet',
} as const;

// ── Defaults ──────────────────────────────────────────────────────────────────

/** 300 m — close enough to be actionable, far enough not to be spammy. */
export const DEFAULT_RADIUS_M  = 300;
/** Proximity alerts are ON until the user explicitly disables them. */
export const DEFAULT_ENABLED   = true;

// ── Unit preference (feet vs metres) ─────────────────────────────────────────

/** Returns true if the user prefers feet; detects US locale by default. */
export async function getUseFeet(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(K.useFeet);
  if (raw !== null) return raw === 'true';
  // Default: US locale → feet, everywhere else → metres
  const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  return locale.endsWith('-US') || locale === 'en-US';
}

export async function setUseFeet(useFeet: boolean): Promise<void> {
  await AsyncStorage.setItem(K.useFeet, String(useFeet));
}

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
