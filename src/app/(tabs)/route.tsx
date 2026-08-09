import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../../lib/theme';
import { generateItinerary, ItineraryStop, Vibe } from '../../../lib/itinerary';
import { routeStore } from '../../../lib/route-store';

// ─── Vibe options ─────────────────────────────────────────────────────────────

const VIBES: { key: Vibe; label: string; emoji: string }[] = [
  { key: 'relaxed',        label: 'Relaxed',  emoji: '☕' },
  { key: 'packed',         label: 'Packed',   emoji: '⚡' },
  { key: 'food-focused',   label: 'Food',     emoji: '🍽' },
  { key: 'culture-focused', label: 'Culture', emoji: '🏛' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function RouteScreen() {
  const insets = useSafeAreaInsets();

  // ── Local state ────────────────────────────────────────────────────────────

  const [vibe,   setVibe]   = useState<Vibe>('relaxed');
  const [hours,  setHours]  = useState(3);
  const [stops,  setStops]  = useState<ItineraryStop[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState('');

  // ── Route store subscription ───────────────────────────────────────────────
  // Merges manually-added places (tapped "Add to today's route" on the map) into
  // the stops list. Runs on mount to catch any places added before this tab was
  // opened, and subscribes to future additions so the list updates in real-time.

  useEffect(() => {
    // Helper: merge any routeStore stops not already in `stops`
    function syncManual() {
      setStops((prev) => {
        const existingIds = new Set(prev.map((s) => s.placeId));
        const incoming    = routeStore.getAll().filter((s) => !existingIds.has(s.placeId));
        if (incoming.length === 0) return prev;
        // Prepend new manual stops so they appear at the top of the list
        return [...incoming, ...prev];
      });
    }

    syncManual();                                  // load anything already queued
    return routeStore.subscribe(syncManual);       // stay in sync going forward
  }, []);

  // ── Generate route ─────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    setStatus('loading');
    setErrMsg('');

    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        throw new Error('Location permission is required to generate a route.');
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const result = await generateItinerary(
        { lat: loc.coords.latitude, lng: loc.coords.longitude },
        hours,
        vibe
      );

      // Merge: keep manually-added stops that the AI didn't include
      const aiPlaceIds = new Set(result.map((s) => s.placeId));
      const manualOnly = routeStore.getAll().filter((s) => !aiPlaceIds.has(s.placeId));
      setStops([...result, ...manualOnly]);
      setStatus('success');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }, [hours, vibe]);

  // ── Draggable card ─────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<ItineraryStop>) => (
      <ScaleDecorator activeScale={1.02}>
        <Pressable
          onLongPress={drag}
          disabled={isActive}
          style={[styles.card, isActive && styles.cardActive]}
        >
          {/* Drag handle — three horizontal bars on the left */}
          <View style={styles.dragHandle}>
            <View style={styles.dragBar} />
            <View style={styles.dragBar} />
            <View style={styles.dragBar} />
          </View>

          {/* Main text content */}
          <View style={styles.cardBody}>
            <Text style={styles.cardName} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.cardCategory}>{item.category}</Text>
            <Text style={styles.cardReason} numberOfLines={3}>
              {item.reason}
            </Text>
          </View>

          {/* Visit-time badge on the right */}
          <View style={styles.timeBadge}>
            <Text style={styles.timeBadgeNum}>{item.suggestedMinutes}</Text>
            <Text style={styles.timeBadgeUnit}>min</Text>
          </View>
        </Pressable>
      </ScaleDecorator>
    ),
    []
  );

  // ── List header ────────────────────────────────────────────────────────────

  const ListHeader = (
    <View style={[styles.header, { paddingTop: insets.top + 20 }]}>

      {/* Screen title */}
      <Text style={styles.screenTitle}>Route</Text>
      <Text style={styles.screenSubtitle}>
        Choose a vibe, set your time, and get a walking itinerary
      </Text>

      {/* ── Vibe picker ─────────────────────────────────────────────────── */}

      <Text style={styles.sectionLabel}>Vibe</Text>
      <View style={styles.vibeRow}>
        {VIBES.map(({ key, label, emoji }) => (
          <Pressable
            key={key}
            style={[styles.vibeBtn, vibe === key && styles.vibeBtnActive]}
            onPress={() => setVibe(key)}
          >
            <Text style={styles.vibeEmoji}>{emoji}</Text>
            <Text style={[styles.vibeLabel, vibe === key && styles.vibeLabelActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Time slider ─────────────────────────────────────────────────── */}

      <View style={styles.sliderHeader}>
        <Text style={styles.sectionLabel}>Time available</Text>
        <Text style={styles.hoursValue}>
          {hours} {hours === 1 ? 'hour' : 'hours'}
        </Text>
      </View>

      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={8}
        step={1}
        value={hours}
        onValueChange={(v) => setHours(v)}
        minimumTrackTintColor={Colors.sage}
        maximumTrackTintColor={Colors.sageTint}
        thumbTintColor={Colors.forest}
      />

      {/* Hour labels below the slider track */}
      <View style={styles.tickRow}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
          <Text
            key={h}
            style={[styles.tick, h === hours && styles.tickActive]}
          >
            {h}
          </Text>
        ))}
      </View>

      {/* ── Generate button ──────────────────────────────────────────────── */}

      <Pressable
        style={[
          styles.generateBtn,
          status === 'loading' && styles.generateBtnDisabled,
        ]}
        onPress={handleGenerate}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? (
          <ActivityIndicator color={Colors.sageTint} />
        ) : (
          <Text style={styles.generateBtnText}>Generate Route</Text>
        )}
      </Pressable>

      {/* ── Error banner ─────────────────────────────────────────────────── */}

      {status === 'error' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errMsg}</Text>
        </View>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}

      {status === 'success' && stops.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📍</Text>
          <Text style={styles.emptyText}>
            No saved places found within walking distance.
          </Text>
          <Text style={styles.emptyHint}>
            Tap the + button on the Map tab to save a place first.
          </Text>
        </View>
      )}

      {/* ── Results heading ───────────────────────────────────────────────── */}

      {stops.length > 0 && (
        <View style={styles.resultsHeadingRow}>
          <Text style={styles.resultsHeading}>
            Your route · {stops.length} stop{stops.length !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.resultsHint}>Long-press a card to reorder</Text>
        </View>
      )}
    </View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <GestureHandlerRootView style={styles.root}>
      <DraggableFlatList
        data={stops}
        renderItem={renderItem}
        keyExtractor={(item) => item.placeId}
        onDragEnd={({ data }) => setStops(data)}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + BottomTabInset + 24 },
        ]}
      />
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── Root ───────────────────────────────────────────────────────────────────

  root: {
    flex: 1,
    backgroundColor: Colors.mist,
  },

  listContent: {
    paddingHorizontal: 0,
  },

  // ── Header ─────────────────────────────────────────────────────────────────

  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },

  screenTitle: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: FontSize.screenTitle,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },

  screenSubtitle: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.body,          // 15 px
    color: Colors.sage,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },

  // ── Section label ──────────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: Typography.bodyFont,
    fontSize: 10,
    color: Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
  },

  // ── Vibe buttons ───────────────────────────────────────────────────────────

  vibeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },

  vibeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.sage,
  },

  vibeBtnActive: {
    backgroundColor: Colors.sageTint,
    borderColor: Colors.forest,
  },

  vibeEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },

  vibeLabel: {
    fontFamily: Typography.bodyFont,
    fontSize: 13,
    color: Colors.ink,
  },

  vibeLabelActive: {
    color: Colors.forest,
    fontFamily: Typography.bodyFontMedium,
  },

  // ── Time slider ────────────────────────────────────────────────────────────

  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: Spacing.xs,
  },

  hoursValue: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: FontSize.body,          // 15 px
    color: Colors.ink,
  },

  slider: {
    marginHorizontal: -10,
    height: 40,
  },

  tickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.xl,
  },

  tick: {
    fontFamily: Typography.bodyFont,
    fontSize: 11,
    color: Colors.sageTint,
    width: 16,
    textAlign: 'center',
  },

  tickActive: {
    color: Colors.sage,
    fontFamily: Typography.bodyFontMedium,
  },

  // ── Generate button ────────────────────────────────────────────────────────

  generateBtn: {
    backgroundColor: Colors.forest,
    borderRadius: Radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    minHeight: 52,
  },

  generateBtnDisabled: {
    backgroundColor: Colors.disabled,
  },

  generateBtnText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: FontSize.body,          // 15 px
    color: Colors.sageTint,
  },

  // ── Error banner ───────────────────────────────────────────────────────────

  errorBanner: {
    backgroundColor: Colors.errorBg,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: Colors.locationPin,
  },

  errorText: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,      // 12 px
    color: Colors.errorText,
    lineHeight: 18,
  },

  // ── Empty state ────────────────────────────────────────────────────────────

  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: Spacing.lg,
  },

  emptyEmoji: {
    fontSize: 36,
    marginBottom: Spacing.md,
  },

  emptyText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: FontSize.body,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },

  emptyHint: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,
    color: Colors.sage,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Results heading ────────────────────────────────────────────────────────

  resultsHeadingRow: {
    marginBottom: Spacing.md,
  },

  resultsHeading: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: 17,
    color: Colors.ink,
    marginBottom: 2,
  },

  resultsHint: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,
    color: Colors.sage,
  },

  // ── Itinerary card ─────────────────────────────────────────────────────────

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,          // 12 px
    borderWidth: 0.5,
    borderColor: Colors.sage,
    padding: Spacing.lg,
  },

  cardActive: {
    // Slightly elevated while dragging
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },

  // Drag handle — three short horizontal bars on the left
  dragHandle: {
    width: 20,
    gap: 4,
    alignItems: 'center',
    marginRight: Spacing.md,
    opacity: 0.35,
  },

  dragBar: {
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.ink,
  },

  cardBody: {
    flex: 1,
    marginRight: Spacing.md,
  },

  cardName: {
    fontFamily: Typography.displayFont,
    fontSize: FontSize.body,          // 14 px
    color: Colors.ink,
    marginBottom: 3,
  },

  cardCategory: {
    fontFamily: Typography.bodyFont,
    fontSize: 10,
    color: Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },

  cardReason: {
    fontFamily: Typography.bodyFont,
    fontSize: FontSize.metadata,      // 12 px
    color: Colors.sage,
    lineHeight: 18,
  },

  // Visit-time badge on the right side of the card
  timeBadge: {
    alignItems: 'center',
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minWidth: 52,
  },

  timeBadgeNum: {
    fontFamily: Typography.bodyFontMedium,
    fontSize: FontSize.metadata,      // 12 px
    color: Colors.sage,
    lineHeight: 18,
  },

  timeBadgeUnit: {
    fontFamily: Typography.bodyFont,
    fontSize: 10,
    color: Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
