import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../../lib/theme';
import { getAllPlaces } from '../../../lib/db';
import { placeSavedEvent } from '../../../lib/places-event';
import { requestNotificationPermission, scheduleProximityAlert } from '../../../lib/notifications';
import { placeToStop, routeStore } from '../../../lib/route-store';
import type { Place } from '../../../lib/models';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

// Straight-line distance in km between two coordinate pairs (Haversine formula).
// Accurate to ~0.3 % for walking distances; fast enough to call on every render.
function haversineDistanceKm(
  from: { latitude: number; longitude: number },
  to:   { lat: number; lng: number }
): number {
  const R    = 6371;
  const dLat = ((to.lat - from.latitude)  * Math.PI) / 180;
  const dLng = ((to.lng - from.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) *
    Math.cos((to.lat        * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Converts a raw km value into a readable string (metres below 1 km).
function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Human-readable label for each sourceType value on the Place model.
function formatSourceType(type: Place['sourceType']): string {
  switch (type) {
    case 'instagram': return 'Instagram';
    case 'maps':      return 'Maps';
    case 'manual':    return 'Manually added';
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  // Animated value that drives the bottom card sliding up (0 = hidden, 1 = visible)
  const cardAnim = useRef(new Animated.Value(0)).current;

  // When a Marker is tapped, its event bubbles up to MapView.onPress.
  // We set this flag synchronously in the Marker handler so the MapView handler
  // can skip calling closeCard (which would immediately undo the openCard call).
  const suppressMapPress = useRef(false);

  // Guards the location subscription so the AppState listener can call
  // startWatching() without risk of creating a second parallel subscription.
  const watchingRef    = useRef(false);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  // Tracks the current map region so zoom buttons know what delta to start from.
  // Stored in a ref so updates don't trigger re-renders.
  const currentRegion = useRef<Region>({
    latitude: 48.8566,
    longitude: 2.3522,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  // The user's most recent GPS position
  const [userCoords, setUserCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // All saved places loaded from the local database
  const [places, setPlaces] = useState<Place[]>([]);

  // The place whose info card is currently showing (null = no card)
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

  // True when the user has explicitly denied location access
  const [permissionDenied, setPermissionDenied] = useState(false);

  // ── Location ──────────────────────────────────────────────────────────────

  useEffect(() => {
    // Track whether we have already panned the map to the user once.
    // Lives in a closure variable (not a ref) so it resets naturally if the
    // tab unmounts and remounts — we want to re-centre on fresh mount.
    let centeredOnce = false;

    // Starts the GPS subscription.
    //   shouldRequest = true  → show the iOS permission dialog if undetermined
    //   shouldRequest = false → called from AppState listener; only acts if the
    //                           user has already granted from Settings — never
    //                           re-prompts, so coming to foreground is silent
    //                           when permission is still denied.
    async function startWatching(shouldRequest: boolean) {
      // Guard: only one active subscription at a time
      if (watchingRef.current) return;

      const { status } = shouldRequest
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();

      console.log('[GPS] permission status:', status, '| requested:', shouldRequest);

      if (status !== 'granted') {
        // Only show the banner when we explicitly asked (not on a background recheck)
        if (shouldRequest) {
          setPermissionDenied(true);
          console.warn('[GPS] permission denied — user dot will not appear');
        }
        return;
      }

      // Permission is granted — hide the banner and start tracking
      setPermissionDenied(false);
      watchingRef.current = true;
      console.log('[GPS] permission granted, starting watchPositionAsync');

      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,    // Re-check at most every 5 seconds
          distanceInterval: 10,  // Or every 10 metres — whichever comes first
        },
        (loc) => {
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setUserCoords(coords);

          // Pan and zoom to the user's position on the very first GPS fix
          if (!centeredOnce && mapRef.current) {
            centeredOnce = true;
            mapRef.current.animateToRegion(
              { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 },
              800
            );
          }
        }
      );
    }

    // Initial start — requests permission when the map tab first mounts
    startWatching(true);

    // AppState listener — fires whenever the app returns to the foreground.
    // If the user went to Settings, granted permission, then came back,
    // startWatching(false) will detect the new grant, hide the banner,
    // and begin the subscription without needing an app restart.
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        startWatching(false);
      }
    });

    // Cleanup: remove AppState listener and GPS subscription on unmount
    return () => {
      appStateSub.remove();
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      watchingRef.current    = false;
    };
  }, []);

  // ── Data ──────────────────────────────────────────────────────────────────

  // Reload places helper — shared by both triggers below
  const reloadPlaces = useCallback(() => {
    getAllPlaces()
      .then((loaded) => {
        console.log('[Map] reloadPlaces — got', loaded.length, 'place(s)');
        setPlaces(loaded);
      })
      .catch((err) => console.error('[Map] getAllPlaces error:', err));
  }, []);

  // Reload when this tab comes into focus (e.g. user switches tabs)
  useFocusEffect(useCallback(() => { reloadPlaces(); }, [reloadPlaces]));

  // Also reload immediately when a save completes — the modal never blurs
  // the map tab, so useFocusEffect alone won't catch it.
  useEffect(() => placeSavedEvent.subscribe(reloadPlaces), [reloadPlaces]);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    if (!mapRef.current) return;
    const r = currentRegion.current;
    const factor = direction === 'in' ? 0.5 : 2;
    // Clamp so we never zoom further in than ~50 m or further out than the whole globe
    const newDelta = Math.min(Math.max(r.latitudeDelta * factor, 0.0005), 100);
    mapRef.current.animateToRegion(
      { ...r, latitudeDelta: newDelta, longitudeDelta: newDelta },
      250
    );
  }, []);

  // ── Card animation ────────────────────────────────────────────────────────

  // Slide the info card up when a pin is tapped
  const openCard = useCallback(
    (place: Place) => {
      console.log('[Card] openCard called — place:', place.name, '| id:', place.id);
      setSelectedPlace(place);
      Animated.spring(cardAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    },
    [cardAnim]
  );

  // Slide the info card back down and clear the selection.
  // IMPORTANT: only set selectedPlace to null when the animation fully completes
  // (finished === true). If another animation interrupts this one — e.g. openCard
  // starting a spring while this timing is still running — finished will be false
  // and we must NOT wipe out the newly-set selectedPlace.
  const closeCard = useCallback(() => {
    Animated.timing(cardAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setSelectedPlace(null);
    });
  }, [cardAnim]);

  // The card starts 320 px below its resting position and slides up to 0.
  // 320 px gives enough travel distance for the taller branded card.
  const cardTranslateY = cardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [320, 0],
  });

  // Straight-line distance from the user to the currently open place.
  // Null when there is no GPS fix yet — the pill is hidden in that case.
  const distanceText =
    userCoords && selectedPlace
      ? formatDistance(haversineDistanceKm(userCoords, selectedPlace.coordinates))
      : null;

  // ── DEBUG: fire a proximity notification for the nearest saved place ────────
  // Removed before shipping — lets us verify notification copy and logic in
  // the simulator without needing background geofencing or a physical device.

  const [debugFiring, setDebugFiring] = useState(false);

  const handleDebugNotification = useCallback(async () => {
    if (places.length === 0) {
      console.warn('[Debug] No saved places — save at least one place first');
      return;
    }
    setDebugFiring(true);

    // Request permission on first press (no-op if already granted)
    const granted = await requestNotificationPermission();
    if (!granted) {
      console.warn('[Debug] Notification permission denied');
      setDebugFiring(false);
      return;
    }

    // Find the nearest place — use current GPS position when available,
    // otherwise fall back to the current map centre so the debug button
    // always works even with no GPS fix.
    const origin = userCoords ?? {
      latitude:  currentRegion.current.latitude,
      longitude: currentRegion.current.longitude,
    };

    let nearest  = places[0];
    let minDist  = haversineDistanceKm(origin, nearest.coordinates);

    for (const place of places.slice(1)) {
      const d = haversineDistanceKm(origin, place.coordinates);
      if (d < minDist) { minDist = d; nearest = place; }
    }

    console.log(
      `[Debug] Nearest place: "${nearest.name}" — ${minDist.toFixed(3)} km`
    );

    await scheduleProximityAlert(nearest, minDist, { force: true });
    setDebugFiring(false);
  }, [places, userCoords]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>

      {/* ── Full-screen Apple MapKit map ── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        // We draw our own orange dot, so we disable the native blue one
        showsUserLocation={false}
        showsCompass
        showsScale
        // Tapping anywhere on the map dismisses the open card.
        // Marker taps bubble up to this handler too, so we check suppressMapPress
        // before closing — if a Marker just set the flag, skip the close entirely.
        onPress={() => {
          if (suppressMapPress.current) {
            suppressMapPress.current = false;
            return;
          }
          closeCard();
        }}
        // Long-pressing drops a pin and opens the Save screen with coords pre-filled
        onLongPress={(e) => {
          closeCard();
          const { latitude, longitude } = e.nativeEvent.coordinate;
          router.push(`/save?lat=${latitude}&lng=${longitude}`);
        }}
        // Keep currentRegion in sync so zoom buttons always start from the right delta
        onRegionChangeComplete={(region) => {
          currentRegion.current = region;
        }}
        // Shown before the first GPS fix arrives — falls back to Paris
        initialRegion={{
          latitude: 48.8566,
          longitude: 2.3522,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
      >
        {/* ── User location dot (warm orange) ── */}
        {userCoords && (
          <Marker
            coordinate={userCoords}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            // Prevent tapping the dot from dismissing any open card
            onPress={() => {}}
          >
            {/* Outer translucent ring + solid inner dot to mimic the iOS location style */}
            <View style={styles.userDotOuter}>
              <View style={styles.userDotInner} />
            </View>
          </Marker>
        )}

        {/* ── Saved place pins (sage green) ── */}
        {places.map((place) => (
          <Marker
            key={place.id}
            coordinate={{
              latitude: place.coordinates.lat,
              longitude: place.coordinates.lng,
            }}
            pinColor={Colors.sage}
            onPress={() => {
              // Set the suppression flag BEFORE this event bubbles to MapView.onPress.
              // The map handler runs synchronously after this returns and will see
              // the flag, skip closeCard, and leave selectedPlace alone.
              suppressMapPress.current = true;
              openCard(place);
            }}
          />
        ))}
      </MapView>

      {/* ── Zoom controls ── */}
      <View
        style={[
          styles.zoomCluster,
          { bottom: insets.bottom + BottomTabInset + 16, right: Spacing.xl },
        ]}
      >
        <Pressable
          style={styles.zoomBtn}
          onPress={() => handleZoom('in')}
          hitSlop={4}
        >
          <Text style={styles.zoomBtnText}>+</Text>
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable
          style={styles.zoomBtn}
          onPress={() => handleZoom('out')}
          hitSlop={4}
        >
          <Text style={styles.zoomBtnText}>−</Text>
        </Pressable>
      </View>

      {/* ── Save a place FAB ── */}
      <Pressable
        style={[styles.fab, { bottom: insets.bottom + BottomTabInset + 120 }]}
        onPress={() => router.push('/save')}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      {/* ── DEBUG: proximity notification trigger ── */}
      {/* TODO: remove before shipping to production */}
      <Pressable
        style={[styles.debugBtn, { top: insets.top + 12 }]}
        onPress={handleDebugNotification}
        disabled={debugFiring || places.length === 0}
      >
        <Text style={styles.debugBtnText}>
          {debugFiring
            ? '⏳ firing…'
            : places.length === 0
              ? '🔕 no places'
              : '🔔 debug notify'}
        </Text>
      </Pressable>

      {/* ── Permission-denied banner ── */}
      {permissionDenied && (
        <View style={[styles.permissionBanner, { top: insets.top + 12 }]}>
          <Text style={styles.permissionText}>
            Location access denied — enable it in Settings to show your position
          </Text>
        </View>
      )}

      {/* ── Bottom info card — slides up when a pin is tapped ── */}
      {selectedPlace && (
        <Animated.View
          style={[
            styles.card,
            { paddingBottom: insets.bottom + BottomTabInset + 16 },
            { transform: [{ translateY: cardTranslateY }] },
          ]}
        >
          {/* Drag handle */}
          <View style={styles.cardHandle} />

          {/* Top-right action row: Edit pill + Close circle */}
          <View style={styles.cardTopActions}>
            <Pressable
              style={styles.editButton}
              hitSlop={8}
              onPress={() => {
                // Navigate to save screen pre-filled with this place's data.
                // Use the object form of router.push so Expo Router handles
                // URI-encoding of strings with spaces / special characters.
                router.push({
                  pathname: '/save',
                  params: {
                    editId:   selectedPlace.id,
                    name:     selectedPlace.name,
                    category: selectedPlace.category,
                    note:     selectedPlace.note    ?? '',
                    address:  selectedPlace.address ?? '',
                    lat:      String(selectedPlace.coordinates.lat),
                    lng:      String(selectedPlace.coordinates.lng),
                  },
                });
                closeCard();
              }}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </Pressable>
            <Pressable style={styles.closeButton} onPress={closeCard} hitSlop={12}>
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>

          {/* Place name */}
          <Text style={styles.cardName} numberOfLines={2}>
            {selectedPlace.name}
          </Text>

          {/* Category + distance pill on one row */}
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardCategory}>{selectedPlace.category}</Text>
            {distanceText !== null && (
              <View style={styles.distancePill}>
                <Text style={styles.distancePillText}>{distanceText}</Text>
              </View>
            )}
          </View>

          {/* Note section — only shown when the user has written a note */}
          {selectedPlace.note ? (
            <>
              <Text style={styles.noteSectionLabel}>Your Note</Text>
              <View style={styles.noteBox}>
                <Text style={styles.noteText} numberOfLines={4}>
                  {selectedPlace.note}
                </Text>
              </View>
            </>
          ) : null}

          {/* How the place was originally saved */}
          <Text style={styles.addedFrom}>
            Added from {formatSourceType(selectedPlace.sourceType)}
          </Text>

          {/* Primary CTA */}
          <Pressable
            style={styles.routeButton}
            onPress={() => {
              // selectedPlace is guaranteed non-null inside this block
              routeStore.add(placeToStop(selectedPlace));
              closeCard();
              // Navigate to the Route tab so the user can see their addition
              router.push('/(tabs)/route');
            }}
          >
            <Text style={styles.routeButtonText}>Add to today's route</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── Root wrapper — mist background shows briefly before the map tiles load ──

  root: {
    backgroundColor: Colors.mist,
  },

  // ── User location dot ──────────────────────────────────────────────────────

  userDotOuter: {
    // Semi-transparent halo around the dot (20 % opacity of the orange)
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: `${Colors.locationPin}33`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDotInner: {
    // Solid filled circle with a white border — mirrors the iOS location style
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: Colors.locationPin,
    borderWidth: 2,
    borderColor: Colors.white,
  },

  // ── Permission banner ──────────────────────────────────────────────────────

  permissionBanner: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: `${Colors.ink}B8`,   // ink at ~72 % opacity
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  permissionText: {
    fontFamily: Typography.bodyFont,
    color: Colors.white,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Zoom controls ─────────────────────────────────────────────────────────

  zoomCluster: {
    position: 'absolute',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    overflow: 'hidden',
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },

  zoomBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  zoomBtnText: {
    fontFamily: Typography.bodyFont,
    fontSize: 22,
    color: Colors.ink,
    lineHeight: 26,
  },

  zoomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.sage,
    marginHorizontal: Spacing.sm,
  },

  // ── Info card ──────────────────────────────────────────────────────────────

  card: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // zIndex ensures the card sits above the MapView and all other overlays on
    // both iOS (where elevation has no effect) and Android.
    zIndex: 100,
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.md,
    borderTopRightRadius: Radius.md,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    // Subtle drop-shadow upward
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 12,
  },
  cardHandle: {
    // Small pill at the top of the card — common iOS bottom-sheet pattern
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.sageTint,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  cardName: {
    fontFamily: Typography.displayFont,
    fontSize: FontSize.screenTitle,  // 28 px
    color: Colors.ink,
    marginBottom: Spacing.sm,
    paddingRight: 100, // Room for the Edit pill + Close button row
  },

  // Category and distance pill sit side-by-side on one row
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  cardCategory: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,  // 12 px
    color: Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Pill showing straight-line distance to the place
  distancePill: {
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.lg,       // 20 px
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
  },
  distancePillText: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,   // 12 px
    color: Colors.forest,
  },

  // "YOUR NOTE" label above the note box
  noteSectionLabel: {
    fontFamily: Typography.bodyFont,
    fontSize: 11,
    color: Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.7,            // ≈ 0.06 em at 11 px
    marginBottom: Spacing.xs,
  },

  // Bordered box that contains the note text
  noteBox: {
    backgroundColor: Colors.mist,
    borderWidth: 0.5,
    borderColor: Colors.sage,
    borderRadius: Radius.sm,       // 8 px
    padding: Spacing.md,           // 12 px
    marginBottom: Spacing.md,
  },
  noteText: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.body,       // 15 px
    color: Colors.ink,
    lineHeight: 22,
  },

  // "Added from …" provenance line
  addedFrom: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,   // 12 px
    color: Colors.sage,
    marginBottom: Spacing.lg,
  },

  // Primary action button
  routeButton: {
    backgroundColor: Colors.forest,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeButtonText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: FontSize.body,       // 15 px
    color: Colors.sageTint,
  },

  // Row that holds Edit pill + Close circle, anchored to top-right of card
  cardTopActions: {
    position: 'absolute',
    top: 20,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },

  // Pill-shaped secondary button — opens the Save screen in edit mode
  editButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.sage,
    backgroundColor: Colors.mist,
  },
  editButtonText: {
    fontFamily: Typography.bodyFont,
    fontSize: 13,
    color: Colors.sage,
  },

  closeButton: {
    // Circular dismiss button — lives inside cardTopActions row (no longer absolute)
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontFamily: Typography.bodyFont,
    fontSize: 12,
    color: Colors.sage,
  },

  // ── Save a place FAB ───────────────────────────────────────────────────────

  fab: {
    position: 'absolute',
    right: Spacing.xl,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  fabText: {
    fontFamily: Typography.bodyFont,
    color: Colors.white,
    fontSize: 28,
    lineHeight: 32,
  },

  // ── DEBUG button — remove before shipping ─────────────────────────────────

  debugBtn: {
    position: 'absolute',
    left: Spacing.lg,
    backgroundColor: '#1c1c1ecc',  // translucent near-black — stands out on any map tile
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: '#f5a623',        // amber border — unmistakably a dev tool
  },
  debugBtnText: {
    fontFamily: Typography.bodyFont,
    fontSize: 13,
    color: '#f5a623',              // amber text to match border
    letterSpacing: 0.2,
  },
});
