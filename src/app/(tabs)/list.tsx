import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

// ─── Swipeable place card ─────────────────────────────────────────────────────

interface PlaceCardProps {
  place:    Place;
  onEdit:   (place: Place) => void;
  onDelete: (place: Place) => void;
}

function PlaceCard({ place, onEdit, onDelete }: PlaceCardProps) {
  const swipeRef = useRef<SwipeableMethods>(null);

  // ── Left action — Edit (swipe right to reveal) ────────────────────────────
  const renderLeftActions = useCallback(
    () => (
      <Pressable
        style={styles.editAction}
        onPress={() => {
          swipeRef.current?.close();
          onEdit(place);
        }}
      >
        <Text style={styles.editActionText}>Edit</Text>
      </Pressable>
    ),
    [place, onEdit]
  );

  // ── Right action — Delete (swipe left to reveal) ──────────────────────────
  const renderRightActions = useCallback(
    () => (
      <Pressable
        style={styles.deleteAction}
        onPress={() => {
          swipeRef.current?.close();
          onDelete(place);
        }}
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
      {/* ── Card content ── */}
      <View style={styles.card}>
        {/* Top row: name + source badge */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>
            {place.name}
          </Text>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>
              {formatSourceType(place.sourceType)}
            </Text>
          </View>
        </View>

        {/* Category */}
        <Text style={styles.cardCategory}>{place.category}</Text>

        {/* Note — only shown when the user wrote one */}
        {place.note ? (
          <Text style={styles.cardNote} numberOfLines={2}>
            {place.note}
          </Text>
        ) : null}

        {/* Date saved + swipe hint */}
        <View style={styles.cardFooter}>
          <Text style={styles.cardDate}>Saved {formatDate(place.savedAt)}</Text>
          <Text style={styles.swipeHint}>← swipe to edit / delete →</Text>
        </View>
      </View>
    </ReanimatedSwipeable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ListScreen() {
  const insets = useSafeAreaInsets();
  const [places, setPlaces] = useState<Place[]>([]);

  // ── Data loading ───────────────────────────────────────────────────────────

  const reloadPlaces = useCallback(() => {
    getAllPlaces()
      .then((loaded) => {
        console.log('[List] reloadPlaces — got', loaded.length, 'place(s)');
        setPlaces(loaded);
      })
      .catch((err) => console.error('[List] getAllPlaces error:', err));
  }, []);

  useFocusEffect(useCallback(() => { reloadPlaces(); }, [reloadPlaces]));
  useEffect(() => placeSavedEvent.subscribe(reloadPlaces), [reloadPlaces]);

  // ── Edit handler — opens save screen pre-filled ────────────────────────────

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

  // ── Delete handler — confirm then delete ───────────────────────────────────

  const handleDelete = useCallback((place: Place) => {
    Alert.alert(
      'Delete this place?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Delete',
          style:   'destructive',
          onPress: async () => {
            await deletePlace(place.id);
            placeSavedEvent.emit();   // tells map + list to reload
          },
        },
      ]
    );
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    // GestureHandlerRootView is required for ReanimatedSwipeable to receive gestures
    <GestureHandlerRootView style={styles.root}>
      <FlatList
        data={places}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PlaceCard
            place={item}
            onEdit={handleEdit}
            onDelete={handleDelete}
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
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📍</Text>
            <Text style={styles.emptyText}>
              Tap the + button on the Map tab to save your first place.
            </Text>
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
    fontFamily: Typography.displayFont,
    fontSize:   FontSize.screenTitle,
    color:      Colors.ink,
    marginBottom: Spacing.xs,
  },

  screenSubtitle: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    lineHeight: 22,
  },

  // ── Swipeable container ────────────────────────────────────────────────────
  // Matches the card's marginBottom so revealed actions fill the same height

  swipeableContainer: {
    marginBottom: Spacing.md,
    borderRadius: Radius.md,
    overflow: 'hidden',   // clip action buttons to the card's border radius
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
    fontSize:      FontSize.metadata,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
    fontFamily: Typography.bodyFont,
    fontSize:   10,
    color:      `${Colors.sage}66`,
    letterSpacing: 0.2,
  },

  // ── Swipe action buttons ───────────────────────────────────────────────────

  editAction: {
    backgroundColor: Colors.forest,
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: Spacing.xl,
  },

  editActionText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.white,
  },

  deleteAction: {
    backgroundColor: Colors.locationPin,
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: Spacing.xl,
  },

  deleteActionText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.white,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────

  emptyState: {
    alignItems:      'center',
    paddingTop:      80,
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
