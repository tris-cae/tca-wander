import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as Notifications from 'expo-notifications';

import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';
import { deletePlace, savePlace, updatePlace } from '../../lib/db';
import { placeSavedEvent } from '../../lib/places-event';

// ─── Category list ────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Café',
  'Restaurant',
  'Bar',
  'Museum',
  'Park',
  'Shop',
  'Landmark',
  'Market',
  'Hotel',
  'Other',
] as const;

const LABEL_LETTER_SPACING = 0.8;
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

// ─── Reverse geocode ──────────────────────────────────────────────────────────

// Calls the Google Geocoding REST API to turn a lat/lng into a human-readable
// address. Returns null if the key is missing or the request fails.
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`;
    const res  = await fetch(url);
    const json = await res.json() as { results?: Array<{ formatted_address: string }> };
    return json.results?.[0]?.formatted_address ?? null;
  } catch (err) {
    console.warn('[Save] reverseGeocode error:', err);
    return null;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SaveScreen() {
  const insets = useSafeAreaInsets();

  // ── Route params ────────────────────────────────────────────────────────────
  // The screen accepts two modes:
  //   • New place  — lat/lng optional (from map long-press)
  //   • Edit place — editId + all pre-filled fields (from card Edit button)

  const {
    lat, lng,
    editId,
    name:     paramName,
    category: paramCategory,
    note:     paramNote,
    address:  paramAddress,
  } = useLocalSearchParams<{
    lat?:      string;
    lng?:      string;
    editId?:   string;
    name?:     string;
    category?: string;
    note?:     string;
    address?:  string;
  }>();

  const isEditing    = Boolean(editId);
  const pinnedCoords = lat && lng
    ? { lat: parseFloat(lat), lng: parseFloat(lng) }
    : null;

  // ── Form state ─────────────────────────────────────────────────────────────
  // Initialised from URL params when editing so every field is pre-filled.

  const [name,     setName]     = useState(paramName     ?? '');
  const [category, setCategory] = useState(paramCategory ?? '');
  const [note,     setNote]     = useState(paramNote     ?? '');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  // Address and coordinates confirmed via autocomplete or reverse geocode.
  // In edit mode paramAddress is already a confirmed address so show it as a chip immediately.
  const [pickedAddress,     setPickedAddress]     = useState<string | null>(paramAddress || null);
  const [pickedCoordinates, setPickedCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding,         setGeocoding]         = useState(false);

  const autocompleteRef     = useRef<any>(null);
  const nameAutocompleteRef = useRef<any>(null);

  // ── Error auto-dismiss ─────────────────────────────────────────────────────
  // Each call to showError starts a 3-second countdown that clears the message.
  // Cancelling the previous timer before setting a new one prevents the older
  // timer from wiping out a fresher error that was just displayed.

  const errorDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    if (errorDismissTimer.current) clearTimeout(errorDismissTimer.current);
    setError(msg);
    errorDismissTimer.current = setTimeout(() => setError(''), 3000);
  }, []);

  // Cancel any pending dismiss when the screen unmounts
  useEffect(() => {
    return () => {
      if (errorDismissTimer.current) clearTimeout(errorDismissTimer.current);
    };
  }, []);

  // ── Pre-fill name autocomplete in edit mode ────────────────────────────────
  // The GooglePlacesAutocomplete input is uncontrolled (we only wire onChangeText),
  // so we must imperatively set the initial text after the component mounts.

  useEffect(() => {
    if (paramName && nameAutocompleteRef.current) {
      nameAutocompleteRef.current.setAddressText(paramName);
    }
  // Params are stable for the lifetime of this screen — run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reverse geocode pinned coords on mount ─────────────────────────────────
  // Skip in edit mode — the address was passed in as a param and is already shown.

  useEffect(() => {
    if (!pinnedCoords) return;
    if (isEditing)    return;   // already have the address from params
    setGeocoding(true);
    reverseGeocode(pinnedCoords.lat, pinnedCoords.lng).then((address) => {
      if (address) setPickedAddress(address);
      setGeocoding(false);
    });
  // Run once when the screen mounts — params are stable for the lifetime of this screen
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = name.trim().length > 0 && category.length > 0 && !saving;

  // ── Save / Update handler ──────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    // Clear any existing error (and cancel its dismiss timer) before starting
    if (errorDismissTimer.current) clearTimeout(errorDismissTimer.current);
    setError('');

    try {
      // ── Edit mode: UPDATE existing place ──────────────────────────────────
      if (isEditing && editId) {
        await updatePlace(editId, {
          name:        name.trim(),
          category,
          // Use autocomplete pick → pinned coords → original coords (from params)
          coordinates: pickedCoordinates ?? pinnedCoords ?? undefined,
          address:     pickedAddress,
          note:        note.trim() || null,
        });

        console.log('[Save] Place updated in DB:', editId);
        placeSavedEvent.emit();
        router.back();
        return;
      }

      // ── New place: INSERT ─────────────────────────────────────────────────
      let coordinates: { lat: number; lng: number };

      if (pickedCoordinates) {
        // Autocomplete selection — most precise
        coordinates = pickedCoordinates;
      } else if (pinnedCoords) {
        // Map long-press
        coordinates = pinnedCoords;
      } else {
        // Fall back to a live GPS fix
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          showError('Location permission is required to save a place.');
          setSaving(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coordinates = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      }

      const saved = await savePlace({
        name:       name.trim(),
        category,
        coordinates,
        address:    pickedAddress,
        note:       note.trim() || null,
        sourceUrl:  null,
        sourceType: 'manual',
      });

      console.log('[Save] Place written to DB:', JSON.stringify(saved));
      placeSavedEvent.emit();
      router.back();

      // ── Bug 4: Request notification permission after first save ───────────
      // This is the most contextually appropriate moment — the user just proved
      // they care about saving places, so proximity alerts make sense to them.
      // Only fires if permission hasn't been asked yet (status === 'undetermined').
      Notifications.getPermissionsAsync().then(({ status }) => {
        if (status === 'undetermined') {
          Notifications.requestPermissionsAsync();
        }
      });

    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save place.');
      setSaving(false);
    }
  }, [canSave, isEditing, editId, name, category, note, pinnedCoords, pickedCoordinates, pickedAddress]);

  // ── Delete handler (edit mode only) ───────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!editId) return;
    Alert.alert(
      'Delete this place?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Delete',
          style:   'destructive',
          onPress: async () => {
            await deletePlace(editId);
            placeSavedEvent.emit();  // refreshes map + list
            router.back();
          },
        },
      ]
    );
  }, [editId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // The layout is split into two parts so the autocomplete FlatList is never
  // nested inside a ScrollView (which causes the VirtualizedLists warning):
  //   1. A fixed header View containing the title, name input, and address field.
  //   2. A ScrollView below it containing category, note, and the save button.
  // The autocomplete dropdown uses absolute positioning to overlay the ScrollView.

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Fixed header (outside ScrollView so autocomplete FlatList is safe) ── */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>

        <Text style={styles.screenTitle}>
          {isEditing ? 'Edit destination' : 'Save a destination'}
        </Text>

        {/*
          ── Name field ──────────────────────────────────────────────────────
          GooglePlacesAutocomplete searching establishments so the user can
          type a café / restaurant name and pick a real result. Selecting a
          suggestion auto-fills the name and, when the address is still empty,
          pre-fills the address + coordinates too.
          zIndex 30 via styles.container so its dropdown overlays everything below.
        */}
        <Text style={styles.sectionLabel}>Place name</Text>
        <GooglePlacesAutocomplete
          ref={nameAutocompleteRef}
          placeholder="e.g. Café de Flore"
          query={{ key: GOOGLE_API_KEY, language: 'en', types: 'establishment' }}
          fetchDetails={true}
          onPress={(data, details) => {
            const mainText =
              data.structured_formatting?.main_text ?? data.description;
            setName(mainText);
            nameAutocompleteRef.current?.setAddressText(mainText);
            if (!pickedAddress) {
              const loc = details?.geometry?.location;
              if (loc) setPickedCoordinates({ lat: loc.lat, lng: loc.lng });
              const addr = details?.formatted_address ?? data.description;
              if (addr) setPickedAddress(addr);
            }
          }}
          onFail={(err) => console.warn('[Places Name] onFail:', JSON.stringify(err))}
          debounce={300}
          minLength={1}
          enablePoweredByContainer={false}
          keyboardShouldPersistTaps="always"
          textInputProps={{
            onChangeText:        setName,
            autoCapitalize:      'words',
            autoCorrect:         false,
            returnKeyType:       'next',
            placeholderTextColor: `${Colors.sage}99`,
          }}
          styles={{
            container:          { flex: 0, zIndex: 30 },
            textInputContainer: { backgroundColor: 'transparent' },
            textInput: {
              fontFamily:        Typography.bodyFont,
              fontSize:          FontSize.body,
              color:             Colors.ink,
              backgroundColor:   Colors.white,
              borderWidth:       0.5,
              borderColor:       Colors.sage,
              borderRadius:      Radius.sm,
              paddingHorizontal: Spacing.md,
              height:            44,
              marginBottom:      0,
            },
            listView: {
              backgroundColor: Colors.white,
              borderWidth:     0.5,
              borderColor:     Colors.sage,
              borderRadius:    Radius.sm,
              maxHeight:       200,
              marginTop:       2,
              elevation:       6,
              shadowColor:     Colors.ink,
              shadowOffset:    { width: 0, height: 2 },
              shadowOpacity:   0.1,
              shadowRadius:    4,
            },
            row: {
              paddingHorizontal: Spacing.md,
              paddingVertical:   Spacing.sm,
              backgroundColor:   Colors.white,
            },
            description: {
              fontFamily: Typography.bodyFont,
              fontSize:   FontSize.metadata,
              color:      Colors.ink,
            },
            separator: {
              height:          StyleSheet.hairlineWidth,
              backgroundColor: Colors.sageTint,
            },
          }}
        />

        {/*
          ── Address field ────────────────────────────────────────────────────
          Shown as a confirmed chip when an address is already picked (either
          from name autocomplete or from a map long-press reverse geocode).
          Tap the chip to clear it and reveal the search field again.
          zIndex 20 via styles.container — lower than name so name dropdown
          renders on top when both fields briefly compete.
        */}
        <Text style={styles.sectionLabel}>Address</Text>

        {pickedAddress ? (
          <Pressable
            style={styles.addressChip}
            onPress={() => {
              setPickedAddress(null);
              setPickedCoordinates(null);
              autocompleteRef.current?.setAddressText('');
            }}
          >
            {geocoding ? (
              <ActivityIndicator size="small" color={Colors.forest} />
            ) : (
              <>
                <Text style={styles.addressChipText} numberOfLines={2}>
                  📍 {pickedAddress}
                </Text>
                <Text style={styles.addressChipClear}>✕</Text>
              </>
            )}
          </Pressable>
        ) : geocoding ? (
          <View style={styles.geocodingRow}>
            <ActivityIndicator size="small" color={Colors.sage} />
            <Text style={styles.geocodingText}>Looking up address…</Text>
          </View>
        ) : (
          <GooglePlacesAutocomplete
            ref={autocompleteRef}
            placeholder="Search for an address…"
            query={{ key: GOOGLE_API_KEY, language: 'en' }}
            fetchDetails={true}
            onPress={(data, details) => {
              const loc = details?.geometry?.location;
              if (loc) setPickedCoordinates({ lat: loc.lat, lng: loc.lng });
              setPickedAddress(data.description);
            }}
            onFail={(err) => console.warn('[Places] onFail:', JSON.stringify(err))}
            debounce={300}
            minLength={1}
            enablePoweredByContainer={false}
            keyboardShouldPersistTaps="always"
            styles={{
              container:          { flex: 0, zIndex: 20 },
              textInputContainer: { backgroundColor: 'transparent' },
              textInput: {
                fontFamily:        Typography.bodyFont,
                fontSize:          FontSize.body,
                color:             Colors.ink,
                backgroundColor:   Colors.white,
                borderWidth:       0.5,
                borderColor:       Colors.sage,
                borderRadius:      Radius.sm,
                paddingHorizontal: Spacing.md,
                height:            44,
                marginBottom:      0,
              },
              listView: {
                backgroundColor: Colors.white,
                borderWidth:     0.5,
                borderColor:     Colors.sage,
                borderRadius:    Radius.sm,
                maxHeight:       200,
                marginTop:       2,
                elevation:       6,
                shadowColor:     Colors.ink,
                shadowOffset:    { width: 0, height: 2 },
                shadowOpacity:   0.1,
                shadowRadius:    4,
              },
              row: {
                paddingHorizontal: Spacing.md,
                paddingVertical:   Spacing.sm,
                backgroundColor:   Colors.white,
              },
              description: {
                fontFamily: Typography.bodyFont,
                fontSize:   FontSize.metadata,
                color:      Colors.ink,
              },
              separator: {
                height:          StyleSheet.hairlineWidth,
                backgroundColor: Colors.sageTint,
              },
            }}
            textInputProps={{ placeholderTextColor: `${Colors.sage}99` }}
          />
        )}
      </View>

      {/* ── Scrollable lower section ── */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Category ── */}
        <Text style={styles.sectionLabel}>Category</Text>
        <View style={styles.pillRow}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              style={[styles.pill, category === cat && styles.pillSelected]}
              onPress={() => setCategory(cat)}
            >
              <Text style={[styles.pillText, category === cat && styles.pillTextSelected]}>
                {cat}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Your note ── */}
        <Text style={styles.sectionLabel}>Your note</Text>
        <TextInput
          style={[styles.textInput, styles.noteInput]}
          value={note}
          onChangeText={setNote}
          placeholder="Why did you save this place?"
          placeholderTextColor={`${Colors.sage}99`}
          multiline
          textAlignVertical="top"
        />

        {/* ── Save button ── */}
        <Pressable
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!canSave}
        >
          {saving ? (
            <ActivityIndicator color={Colors.sageTint} />
          ) : (
            <Text style={styles.saveButtonText}>
              {isEditing ? 'Save changes' : 'Save destination'}
            </Text>
          )}
        </Pressable>

        {/* ── Inline error — appears below save button, auto-dismisses after 3 s ── */}
        {error !== '' && <Text style={styles.errorText}>{error}</Text>}

        {/* ── Delete button — only shown in edit mode ── */}
        {isEditing && (
          <>
            <View style={styles.deleteSeparator} />
            <Pressable style={styles.deleteButton} onPress={handleDelete}>
              <Text style={styles.deleteButtonText}>Delete this place</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  root: {
    flex: 1,
    backgroundColor: Colors.mist,
  },

  // Fixed top section — title, name autocomplete, address autocomplete
  header: {
    paddingHorizontal: Spacing.xl,
    zIndex: 30,       // must be above the ScrollView so both dropdowns overlay it
  },

  // Scrollable lower section — category, note, save button
  scrollArea: {
    flex: 1,
    zIndex: 1,
  },

  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
  },

  screenTitle: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.cardHeader,
    color:      Colors.ink,
    marginBottom: Spacing.xl,
  },

  sectionLabel: {
    fontFamily:    Typography.bodyFont,
    fontSize:      10,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: LABEL_LETTER_SPACING,
    marginBottom:  Spacing.xs,
    marginTop:     Spacing.lg,
  },

  textInput: {
    backgroundColor:   Colors.white,
    borderWidth:       0.5,
    borderColor:       Colors.sage,
    borderRadius:      Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    fontFamily:        Typography.bodyFont,
    fontSize:          FontSize.body,
    color:             Colors.ink,
  },

  noteInput: {
    height:     108,
    paddingTop: Spacing.sm + 2,
  },

  // ── Confirmed address chip ─────────────────────────────────────────────────

  addressChip: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.sageTint,
    borderRadius:      Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    gap:               Spacing.sm,
    minHeight:         44,
  },

  addressChipText: {
    flex:       1,
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.forest,
    lineHeight: 20,
  },

  addressChipClear: {
    fontFamily: Typography.bodyFont,
    fontSize:   12,
    color:      Colors.sage,
  },

  // ── Reverse-geocode loading row ────────────────────────────────────────────

  geocodingRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    paddingVertical: Spacing.sm,
  },

  geocodingText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
  },

  // ── Category pills ─────────────────────────────────────────────────────────

  pillRow: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Spacing.sm,
  },

  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   7,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.sage,
    backgroundColor:   Colors.white,
  },

  pillSelected: {
    backgroundColor: Colors.sageTint,
    borderColor:     Colors.forest,
  },

  pillText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
  },

  pillTextSelected: {
    color:      Colors.forest,
    fontFamily: Typography.bodyFontMedium,
  },

  errorText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.locationPin,
    marginTop:  Spacing.sm,
    lineHeight: 18,
    textAlign:  'center',
  },

  saveButton: {
    backgroundColor: Colors.forest,
    borderRadius:    Radius.md,
    paddingVertical: 15,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.xl,
    minHeight:       52,
  },

  saveButtonDisabled: {
    backgroundColor: Colors.disabled,
  },

  saveButtonText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.sageTint,
  },

  // ── Delete (edit mode only) ────────────────────────────────────────────────

  deleteSeparator: {
    height:          StyleSheet.hairlineWidth,
    backgroundColor: `${Colors.sage}40`,
    marginTop:       Spacing.xl,
  },

  deleteButton: {
    alignItems:      'center',
    paddingVertical: Spacing.lg,
    marginBottom:    Spacing.md,
  },

  deleteButtonText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.locationPin,
  },
});
