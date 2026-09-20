// ─── Notification lifecycle handlers ──────────────────────────────────────────
//
// Two jobs, both tied to notifications arriving or being tapped:
//
//   1. Foreground haptic — when an alert lands while the user is looking at the
//      app, iOS plays the sound but fires no haptic of its own, so we add one.
//      This is the ONLY case an app can trigger haptics: in background or after
//      termination our JS isn't running, and iOS decides vibration itself based
//      on the ringer switch and the user's system haptic settings.
//
//   2. Deep link on tap — open the map focused on the place the alert was about,
//      rather than dumping the user on whatever screen they left.
//
// Both are installed by useNotificationHandlers(), called once from _layout.tsx.

import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

/** Pulls the placeId out of a notification's data payload, if present. */
function placeIdFrom(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as
    | { placeId?: unknown }
    | undefined;
  return typeof data?.placeId === 'string' ? data.placeId : null;
}

/** Navigates to the Map tab with the given place selected and centred. */
function openPlaceOnMap(placeId: string): void {
  console.log(`[Notifications] tapped → focusing place ${placeId}`);
  router.push({ pathname: '/(tabs)/map', params: { focusPlaceId: placeId } });
}

/**
 * Installs the foreground-haptic and tap-to-navigate handlers.
 *
 * @param ready Pass false until the navigator is mounted. A cold start from a
 *              notification tap resolves before the Stack exists, and calling
 *              router.push() then is a silent no-op — so we hold the pending
 *              tap until the tree is ready to receive it.
 */
export function useNotificationHandlers(ready: boolean): void {
  // Guards against acting twice on the same cold-start notification: the
  // launch response stays available for the whole session.
  const handledColdStart = useRef(false);

  // ── 1. Foreground arrival → haptic ──────────────────────────────────────────
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        // Simulators and devices with haptics disabled throw; never let that
        // bubble up and take down the notification path.
        (err) => console.log('[Notifications] haptic unavailable:', err?.message)
      );
    });
    return () => sub.remove();
  }, []);

  // ── 2a. Tap while the app is already running ────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const placeId = placeIdFrom(response);
      if (placeId) openPlaceOnMap(placeId);
    });
    return () => sub.remove();
  }, [ready]);

  // ── 2b. Tap that launched the app from cold ─────────────────────────────────
  // getLastNotificationResponseAsync() returns the notification the user tapped
  // to launch the app, which the listener above never sees — it was delivered
  // before any JS was running.
  useEffect(() => {
    if (!ready || handledColdStart.current) return;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response || handledColdStart.current) return;
      handledColdStart.current = true;

      const placeId = placeIdFrom(response);
      if (placeId) openPlaceOnMap(placeId);
    });
  }, [ready]);
}
