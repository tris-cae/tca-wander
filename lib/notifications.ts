// ─── Proximity Notification Helper ───────────────────────────────────────────
//
// Wraps expo-notifications with everything the app needs for place-proximity
// alerts. Responsibilities:
//
//   1. requestNotificationPermission()  — ask iOS/Android for access once
//   2. scheduleProximityAlert()         — fire a local notification, honouring
//                                         the 24-hour cooldown and user settings
//   3. cancelAllNotifications()         — housekeeping; clears queued alerts

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { getLastNotifiedAt, recordNotification } from './db';
import { getNotificationRadius, getNotificationsEnabled, getUseFeet } from './settings';
import { formatDistance } from './units';
import type { Place } from './models';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum time between notifications for the same place (24 hours). */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Android notification channel. Ignored on iOS. */
const ANDROID_CHANNEL_ID = 'proximity';

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
  await ensureAndroidChannel();

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  // allowSound must be requested explicitly — the no-argument form does not
  // reliably include sound authorisation on iOS, which delivers every alert
  // silently regardless of the `sound` field on the notification itself.
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return status === 'granted';
}

/**
 * Creates the Android notification channel that carries sound and vibration.
 * On Android 8+ these properties live on the channel, not the notification —
 * without a channel that declares them, alerts arrive silent and still.
 * No-op on iOS.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name:             'Nearby places',
    importance:       Notifications.AndroidImportance.HIGH,
    sound:            'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate:    true,
  });
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
  // Distance respects the user's feet/metres preference from Profile, via the
  // same formatter the rest of the app uses.
  const useFeet       = await getUseFeet();
  const distanceLabel = `${formatDistance(distanceKm * 1000, useFeet)} away`;
  const categoryLabel = place.category ? `${place.category} · ` : '';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `📍 You're near ${place.name}`,
      body:  `${categoryLabel}${distanceLabel}`,
      // Read by the tap handler in lib/notification-routing.ts to open this place
      data:  { placeId: place.id },
      // 'default' (not `true`) is the documented value and the one iOS honours.
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
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
