import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../../lib/theme';
import { deletePlace, getAllPlaces } from '../../../lib/db';
import { placeSavedEvent } from '../../../lib/places-event';
import { placeToStop, routeStore } from '../../../lib/route-store';
import type { Place } from '../../../lib/models';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatSourceType(type: Place['sourceType']): string {
  switch (type) {
    case 'instagram': return 'Instagram';
    case 'maps':      return 'Maps';
    case 'manual':    return 'Manually added';
  }
}

// Extract a city name from a Google Places formatted_address string.
// Google addresses typically end with "…, City, Country" (international) or
// "…, City, State ZIP, USA" (US). We walk backwards past the country and any
// pure postal/state segment to find the city name.
function extractCity(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(', ');
  if (parts.length < 2) return null;

  const country = parts[parts.length - 1];

  // US addresses: "Street, City, State ZIP, USA"
  const isUS = /^(united states|usa)$/i.test(country);
  if (isUS && parts.length >= 3) {
    return parts[parts.length - 3] ?? null;
  }

  // International: second-to-last may have a leading postal code e.g. "75006 Paris"
  const secondLast = parts[parts.length - 2];
  return secondLast.replace(/^\d[\d\s-]*(?=[A-Za-z])/, '').trim() || secondLast;
}

// ─── City folder card ─────────────────────────────────────────────────────────

interface CityFolderProps {
  city:    string;
  count:   number;
  onPress: () => void;
}

function CityFolder({ city, count, onPress }: CityFolderProps) {
  return (
    <Pressable style={styles.folderCard} onPress={onPress}>
      <View style={styles.folderLeft}>
        <Text style={styles.folderCity}>{city}</Text>
        <Text style={styles.folderCount}>
          {count} place{count !== 1 ? 's' : ''}
        </Text>
      </View>
      <Text style={styles.folderChevron}>›</Text>
    </Pressable>
  );
}

// ─── Swipeable place card ─────────────────────────────────────────────────────

interface PlaceCardProps {
  place:    Place;
  onEdit:   (place: Place) => void;
  onDelete: (place: Place) => void;
  onRoute:  (place: Place) => void;
}

function PlaceCard({ place, onEdit, onDelete, onRoute }: PlaceCardProps) {
  const swipeRef = useRef<SwipeableMethods>(null);

  const renderLeftActions = useCallback(
    (_progress: unknown, _drag: unknown, swipeable: SwipeableMethods) => (
      <Pressable
        style={styles.editAction}
        onPress={() => { swipeable.close(); onEdit(place); }}
      >
        <Text style={styles.editActionText}>Edit</Text>
      </Pressable>
    ),
    [place, onEdit]
  );

  const renderRightActions = useCallback(
    (_progress: unknown, _drag: unknown, swipeable: SwipeableMethods) => (
      <Pressable
        style={styles.deleteAction}
        onPress={() => { swipeable.close(); onDelete(place); }}
      >
        <Text style={styles.deleteActionText}>Delete</Text>
      </Pressable>
    ),
    [place, onDelete]
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      containerStyle={styles.swipeableContainer}
    >
      <Pressable
        style={styles.card}
        onPress={() => {
          Alert.alert(place.name, undefined, [
            { text: 'Edit',         onPress: () => onEdit(place) },
            { text: 'Add to Route', onPress: () => onRoute(place) },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>{place.name}</Text>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>
              {formatSourceType(place.sourceType)}
            </Text>
          </View>
        </View>

        <Text style={styles.cardCategory}>{place.category}</Text>

        {place.note ? (
          <Text style={styles.cardNote} numberOfLines={2}>{place.note}</Text>
        ) : null}

        <View style={styles.cardFooter}>
          <Text style={styles.cardDate}>Saved {formatDate(place.savedAt)}</Text>
          <Text style={styles.swipeHint}>tap · swipe → edit · ← delete</Text>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ListScreen() {
  const insets = useSafeAreaInsets();
  const [places,       setPlaces]       = useState<Place[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // ── Data loading ───────────────────────────────────────────────────────────

  const reloadPlaces = useCallback(() => {
    getAllPlaces()
      .then(setPlaces)
      .catch((err) => console.error('[List] getAllPlaces error:', err));
  }, []);

  useFocusEffect(useCallback(() => { reloadPlaces(); }, [reloadPlaces]));
  useEffect(() => placeSavedEvent.subscribe(reloadPlaces), [reloadPlaces]);

  // ── Group places by city ───────────────────────────────────────────────────

  const { folderMap, ungrouped } = useMemo(() => {
    const map = new Map<string, Place[]>();
    const noCity: Place[] = [];
    for (const place of places) {
      const city = extractCity(place.address);
      if (!city) {
        noCity.push(place);
      } else {
        const existing = map.get(city) ?? [];
        map.set(city, [...existing, place]);
      }
    }
    return { folderMap: map, ungrouped: noCity };
  }, [places]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleEdit = useCallback((place: Place) => {
    router.push({
      pathname: '/save',
      params: {
        editId:   place.id,
        name:     place.name,
        category: place.category,
        note:     place.note    ?? '',
        address:  place.address ?? '',
        lat:      String(place.coordinates.lat),
        lng:      String(place.coordinates.lng),
      },
    });
  }, []);

  const handleRoute = useCallback((place: Place) => {
    routeStore.add(placeToStop(place));
    Alert.alert('Added to Route', `${place.name} has been added to your route.`);
  }, []);

  const handleDelete = useCallback((place: Place) => {
    Alert.alert('Delete this place?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text:    'Delete',
        style:   'destructive',
        onPress: async () => {
          await deletePlace(place.id);
          placeSavedEvent.emit();
        },
      },
    ]);
  }, []);

  // ── City detail view ───────────────────────────────────────────────────────

  if (selectedCity !== null) {
    const cityPlaces = folderMap.get(selectedCity) ?? [];
    return (
      <GestureHandlerRootView style={styles.root}>
        <FlatList
          data={cityPlaces}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlaceCard
              place={item}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRoute={handleRoute}
            />
          )}
          ListHeaderComponent={
            <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
              <Pressable style={styles.backRow} onPress={() => setSelectedCity(null)}>
                <Text style={styles.backChevron}>‹</Text>
                <Text style={styles.backLabel}>All places</Text>
              </Pressable>
              <Text style={styles.screenTitle}>{selectedCity}</Text>
              <Text style={styles.screenSubtitle}>
                {cityPlaces.length} place{cityPlaces.length !== 1 ? 's' : ''}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📍</Text>
              <Text style={styles.emptyText}>No places in {selectedCity}.</Text>
            </View>
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + BottomTabInset + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        />
      </GestureHandlerRootView>
    );
  }

  // ── Folder view ────────────────────────────────────────────────────────────

  const folders = Array.from(folderMap.entries()).sort((a, b) =>
    b[1].length - a[1].length   // sort by place count descending
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <FlatList
        data={ungrouped}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PlaceCard
            place={item}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRoute={handleRoute}
          />
        )}
        ListHeaderComponent={
          <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
            <Text style={styles.screenTitle}>Places</Text>
            <Text style={styles.screenSubtitle}>
              {places.length === 0
                ? 'No places saved yet'
                : `${places.length} saved place${places.length !== 1 ? 's' : ''}`}
            </Text>

            {/* ── City folders ── */}
            {folders.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>By destination</Text>
                {folders.map(([city, cityPlaces]) => (
                  <CityFolder
                    key={city}
                    city={city}
                    count={cityPlaces.length}
                    onPress={() => setSelectedCity(city)}
                  />
                ))}
              </>
            )}

            {/* ── Ungrouped divider — only shown when there are also folders ── */}
            {folders.length > 0 && ungrouped.length > 0 && (
              <Text style={styles.sectionLabel}>No location</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          folders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📍</Text>
              <Text style={styles.emptyText}>
                Tap the + button on the Map tab to save your first place.
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + BottomTabInset + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  root: {
    flex: 1,
    backgroundColor: Colors.mist,
  },

  listContent: {
    paddingHorizontal: Spacing.xl,
  },

  // ── Header ─────────────────────────────────────────────────────────────────

  header: {
    paddingBottom: Spacing.lg,
  },

  screenTitle: {
    fontFamily:   Typography.bodyFontMedium,
    fontSize:     FontSize.screenTitle,
    color:        Colors.ink,
    marginBottom: Spacing.xs,
  },

  screenSubtitle: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    lineHeight: 22,
  },

  // ── Back navigation (city detail view) ────────────────────────────────────

  backRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  Spacing.md,
    gap:           4,
  },

  backChevron: {
    fontFamily: Typography.bodyFont,
    fontSize:   22,
    color:      Colors.forest,
    lineHeight: 26,
  },

  backLabel: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.forest,
  },

  // ── Section label ──────────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily:    Typography.bodyFont,
    fontSize:      10,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop:     Spacing.lg,
    marginBottom:  Spacing.sm,
  },

  // ── City folder card ───────────────────────────────────────────────────────

  folderCard: {
    backgroundColor: Colors.white,
    borderWidth:     0.5,
    borderColor:     Colors.sage,
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    marginBottom:    Spacing.sm,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
  },

  folderLeft: {
    flex: 1,
  },

  folderCity: {
    fontFamily:   Typography.displayFont,
    fontSize:     FontSize.cardHeader,
    color:        Colors.ink,
    marginBottom: 2,
  },

  folderCount: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
  },

  folderChevron: {
    fontFamily: Typography.bodyFont,
    fontSize:   22,
    color:      Colors.sage,
    lineHeight: 26,
  },

  // ── Swipeable container ────────────────────────────────────────────────────

  swipeableContainer: {
    marginBottom: Spacing.md,
    borderRadius: Radius.md,
    overflow:     'hidden',
  },

  // ── Place card ─────────────────────────────────────────────────────────────

  card: {
    backgroundColor: Colors.white,
    borderWidth:     0.5,
    borderColor:     Colors.sage,
    padding:         Spacing.lg,
  },

  cardHeader: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            Spacing.sm,
    marginBottom:   Spacing.xs,
  },

  cardName: {
    flex:       1,
    fontFamily: Typography.displayFont,
    fontSize:   FontSize.cardHeader,
    color:      Colors.ink,
  },

  sourceBadge: {
    backgroundColor:   Colors.sageTint,
    borderRadius:      Radius.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   3,
  },

  sourceBadgeText: {
    fontFamily: Typography.bodyFont,
    fontSize:   11,
    color:      Colors.forest,
  },

  cardCategory: {
    fontFamily:    Typography.bodyFont,
    fontSize:      10,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
  },

  cardNote: {
    fontFamily:   Typography.bodyFont,
    fontSize:     FontSize.body,
    color:        Colors.ink,
    lineHeight:   22,
    marginBottom: Spacing.sm,
  },

  cardFooter: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },

  cardDate: {
    fontFamily: Typography.bodyFont,
    fontSize:   11,
    color:      `${Colors.sage}99`,
  },

  swipeHint: {
    fontFamily:    Typography.bodyFont,
    fontSize:      10,
    color:         `${Colors.sage}66`,
    letterSpacing: 0.2,
  },

  // ── Swipe action buttons ───────────────────────────────────────────────────

  editAction: {
    width:           80,
    backgroundColor: Colors.forest,
    justifyContent:  'center',
    alignItems:      'center',
  },

  editActionText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.white,
  },

  deleteAction: {
    width:           80,
    backgroundColor: Colors.locationPin,
    justifyContent:  'center',
    alignItems:      'center',
  },

  deleteActionText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.white,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────

  emptyState: {
    alignItems:        'center',
    paddingTop:        80,
    paddingHorizontal: Spacing.xl,
  },

  emptyEmoji: {
    fontSize:     36,
    marginBottom: Spacing.md,
  },

  emptyText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    textAlign:  'center',
    lineHeight: 22,
  },
});
