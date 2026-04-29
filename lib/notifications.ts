// ─── Proximity Notification Helper ───────────────────────────────────────────
//
// Wraps expo-notifications with everything the app needs for place-proximity
// alerts. Responsibilities:
//
//   1. requestNotificationPermission()  — ask iOS/Android for access once
//   2. scheduleProximityAlert()         — fire a local notification, honouring
//                                         the 24-hour cooldown and user settings
//   3. cancelAllNotifications()         — housekeeping; clears queued alerts

import * as Notifications from 'expo-notifications';

import { getLastNotifiedAt, recordNotification } from './db';
import { getNotificationRadius, getNotificationsEnabled } from './settings';
import type { Place } from './models';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum time between notifications for the same place (24 hours). */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ── Foreground presentation ───────────────────────────────────────────────────
// Tell expo-notifications to show banners even when the app is in the
// foreground (default iOS behaviour is to suppress them silently).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});

// ── Permission ────────────────────────────────────────────────────────────────

/**
 * Ask for notification permission (iOS shows the system dialog; Android 13+
 * also requires a runtime grant). Safe to call multiple times — returns the
 * cached status without re-prompting if already decided.
 *
 * Returns `true` if permission was granted, `false` otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ── Proximity alert ───────────────────────────────────────────────────────────

export interface ProximityAlertOptions {
  /**
   * Skip the 24-hour cooldown and the radius check.
   * Use ONLY from the debug button — never in production proximity logic.
   */
  force?: boolean;
}

/**
 * Schedule an immediate local notification for a nearby saved place.
 *
 * Returns `true` if the notification was fired, `false` if it was suppressed
 * (notifications disabled, outside radius, or within cooldown window).
 *
 * @param place      The nearby Place from the database
 * @param distanceKm Straight-line distance in kilometres
 * @param options    Pass `{ force: true }` from debug buttons to skip checks
 */
export async function scheduleProximityAlert(
  place:      Place,
  distanceKm: number,
  options:    ProximityAlertOptions = {}
): Promise<boolean> {

  if (!options.force) {
    // ── Guard 1: user has disabled proximity alerts ──────────────────────────
    const enabled = await getNotificationsEnabled();
    if (!enabled) {
      console.log(`[Notifications] suppressed for "${place.name}" — alerts disabled`);
      return false;
    }

    // ── Guard 2: place is outside the user's chosen alert radius ────────────
    const radiusM    = await getNotificationRadius();
    const distanceM  = distanceKm * 1000;
    if (distanceM > radiusM) {
      console.log(
        `[Notifications] suppressed for "${place.name}" — ` +
        `${Math.round(distanceM)} m > radius ${radiusM} m`
      );
      return false;
    }

    // ── Guard 3: 24-hour cooldown ────────────────────────────────────────────
    const lastNotified = await getLastNotifiedAt(place.id);
    if (lastNotified && Date.now() - lastNotified.getTime() < COOLDOWN_MS) {
      const hoursAgo = ((Date.now() - lastNotified.getTime()) / 3_600_000).toFixed(1);
      console.log(
        `[Notifications] suppressed for "${place.name}" — ` +
        `last notified ${hoursAgo} h ago (cooldown: 24 h)`
      );
      return false;
    }
  }

  // ── Build notification copy ───────────────────────────────────────────────
  const distanceLabel =
    distanceKm < 1
      ? `${Math.round(distanceKm * 1000)} m away`
      : `${distanceKm.toFixed(1)} km away`;

  const categoryLabel = place.category ? `${place.category} · ` : '';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `📍 You're near ${place.name}`,
      body:  `${categoryLabel}${distanceLabel}`,
      // Carry the place id for a future deep-link tap handler
      data:  { placeId: place.id },
      sound: true,
    },
    trigger: null,   // fire immediately
  });

  // Record the timestamp so the cooldown works on the next check
  await recordNotification(place.id);

  console.log(`[Notifications] fired for "${place.name}" (${distanceLabel})`);
  return true;
}

// ── Housekeeping ──────────────────────────────────────────────────────────────

/**
 * Cancel every pending scheduled notification. Call this when proximity
 * alerts are toggled off in settings.
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
