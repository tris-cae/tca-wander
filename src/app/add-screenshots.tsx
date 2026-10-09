// ─── Add from screenshots ─────────────────────────────────────────────────────
//
// Pick up to five screenshots, have the place names read out of them, and land
// on the same review screen typed entry uses.
//
// The images go to the Cloudflare Worker, which calls Anthropic. No API key
// exists in the app. Wording deliberately frames this around Instagram, TikTok,
// notes and articles.

import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HowItWorksLink, HowItWorksSheet } from '@/components/how-it-works';
import { COPY } from '../../lib/import/copy';
import { importHandoff } from '../../lib/import/handoff';
import { MAX_IMPORT_SIZE, MAX_SCREENSHOTS, canImport } from '../../lib/import/import-limits';
import { runLookup } from '../../lib/import/import-run';
import { parseLines } from '../../lib/import/parse-lines';
import type { Coords } from '../../lib/import/types';
import { readScreenshots, WorkerError } from '../../lib/import/worker-client';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

interface PickedImage {
  uri:    string;
  base64: string;
}

export default function AddScreenshotsScreen() {
  const insets = useSafeAreaInsets();

  const [images,     setImages]     = useState<PickedImage[]>([]);
  const [cityLabel,  setCityLabel]  = useState('');
  const [cityCentre, setCityCentre] = useState<Coords | null>(null);
  const [busy,       setBusy]       = useState(false);
  const [stage,      setStage]      = useState<'reading' | 'searching' | null>(null);
  const [progress,   setProgress]   = useState<{ done: number; total: number } | null>(null);
  const [error,      setError]      = useState('');
  const [howOpen,    setHowOpen]    = useState(false);

  const pick = useCallback(async () => {
    setError('');

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Notice needs access to your photos to read screenshots.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:      ['images'],
      allowsMultipleSelection: true,
      selectionLimit:  MAX_SCREENSHOTS,
      base64:          true,
      quality:         0.7,
    });

    if (result.canceled) return;

    const picked = result.assets
      .filter((a) => a.base64)
      .slice(0, MAX_SCREENSHOTS)
      .map((a) => ({ uri: a.uri, base64: a.base64! }));

    if (result.assets.length > MAX_SCREENSHOTS) {
      setError(COPY.screenshots.tooMany(MAX_SCREENSHOTS));
    }
    setImages(picked);
  }, []);

  const handleRead = useCallback(async () => {
    setError('');
    if (images.length === 0) return;
    if (!cityCentre) { setError(COPY.addMany.cityRequired); return; }

    if (!(await canImport())) { router.push('/import-limit'); return; }

    setBusy(true);
    setStage('reading');

    try {
      // 1. Read names out of the images
      const names = await readScreenshots(images.map((i) => i.base64));

      if (names.length === 0) {
        setError(COPY.screenshots.noneFound);
        return;
      }

      // 2. Reuse the same line parser so screenshot names and typed names go
      //    through identical cleaning, de-duplication and capping.
      const parsed = parseLines(names.map((n) => n.name).join('\n'), MAX_IMPORT_SIZE);

      // 3. Carry the model's uncertainty onto the matching line so the review
      //    screen can flag it.
      const uncertainNames = new Set(
        names.filter((n) => n.uncertain).map((n) => n.name.trim().toLowerCase())
      );
      const lines = parsed.lines.map((l) => ({
        ...l,
        uncertain: uncertainNames.has(l.query.trim().toLowerCase()),
      }));

      // 4. Same lookup path as typed entry
      setStage('searching');
      setProgress({ done: 0, total: lines.length });
      const rows = await runLookup(lines, cityCentre, setProgress);

      importHandoff.set({ rows, cityLabel });
      router.push('/import-review');
    } catch (err) {
      if (err instanceof WorkerError) {
        setError(
          err.kind === 'offline'       ? COPY.errors.offline
          : err.kind === 'rate-limited' ? err.message
          :                               COPY.screenshots.failed
        );
      } else {
        setError(COPY.screenshots.failed);
      }
    } finally {
      setBusy(false);
      setStage(null);
      setProgress(null);
    }
  }, [images, cityCentre, cityLabel]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl * 2 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{COPY.screenshots.title}</Text>
        <HowItWorksLink onPress={() => setHowOpen(true)} />
      </View>

      <Text style={styles.intro}>{COPY.screenshots.intro}</Text>
      <Text style={styles.hint}>{COPY.screenshots.hint}</Text>

      {/* ── City or trip ── */}
      <Text style={styles.label}>{COPY.addMany.cityLabel}</Text>
      <GooglePlacesAutocomplete
        placeholder={COPY.addMany.cityPlaceholder}
        query={{ key: GOOGLE_API_KEY, language: 'en', types: '(cities)' }}
        fetchDetails
        onPress={(data, details) => {
          const loc = details?.geometry?.location;
          if (loc) setCityCentre({ lat: loc.lat, lng: loc.lng });
          setCityLabel(data.structured_formatting?.main_text ?? data.description);
        }}
        onFail={(e) => console.warn('[AddScreenshots] city search failed:', JSON.stringify(e))}
        debounce={300}
        minLength={1}
        enablePoweredByContainer={false}
        keyboardShouldPersistTaps="always"
        textInputProps={{ placeholderTextColor: `${Colors.sage}99` }}
        styles={{
          container:          { flex: 0, zIndex: 20 },
          textInputContainer: { backgroundColor: 'transparent' },
          textInput:          styles.input,
          listView:           styles.dropdown,
          row:                { backgroundColor: Colors.white },
          description:        { fontFamily: Typography.bodyFont, color: Colors.ink },
        }}
      />
      <Text style={styles.why}>{COPY.addMany.cityWhy}</Text>

      {/* ── Pick ── */}
      <Pressable style={styles.picker} onPress={pick} disabled={busy}>
        <Text style={styles.pickerText}>
          {images.length > 0
            ? COPY.screenshots.pickedCount(images.length)
            : COPY.screenshots.pickButton}
        </Text>
      </Pressable>

      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
          {images.map((img) => (
            <Image key={img.uri} source={{ uri: img.uri }} style={styles.thumb} />
          ))}
        </ScrollView>
      )}

      {error.length > 0 && (
        <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
      )}

      <Pressable
        style={[styles.cta, (busy || images.length === 0) && styles.ctaDisabled]}
        onPress={handleRead}
        disabled={busy || images.length === 0}
      >
        {busy ? (
          <View style={styles.ctaBusy}>
            <ActivityIndicator color={Colors.sageTint} />
            <Text style={styles.ctaText}>
              {stage === 'reading'
                ? COPY.progress.reading(images.length)
                : progress
                  ? COPY.progress.searching(progress.done, progress.total)
                  : COPY.progress.saving}
            </Text>
          </View>
        ) : (
          <Text style={styles.ctaText}>{COPY.screenshots.readingButton}</Text>
        )}
      </Pressable>

      <HowItWorksSheet visible={howOpen} onClose={() => setHowOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.mist },
  content: { paddingHorizontal: Spacing.xl },

  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: Spacing.xs },
  title:    { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.screenTitle, color: Colors.ink },
  intro:    { fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.sage, lineHeight: 21 },
  hint:     { fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.sage, lineHeight: 18, marginTop: Spacing.sm },

  label: {
    fontFamily: Typography.bodyFont, fontSize: 10, color: Colors.sage,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: Spacing.sm, marginTop: Spacing.xl,
  },
  input: {
    fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.ink,
    backgroundColor: Colors.white, borderWidth: 0.5, borderColor: Colors.sage,
    borderRadius: Radius.sm, paddingHorizontal: Spacing.md, height: 44, marginBottom: 0,
  },
  dropdown: {
    backgroundColor: Colors.white, borderWidth: 0.5, borderColor: Colors.sage,
    borderRadius: Radius.sm, maxHeight: 200, marginTop: 2,
  },
  why: { fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.sage, lineHeight: 18, marginTop: Spacing.sm },

  picker: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.sage,
    borderStyle: 'dashed', borderRadius: Radius.md,
    paddingVertical: Spacing.xl, alignItems: 'center', marginTop: Spacing.xl,
  },
  pickerText: { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.body, color: Colors.forest },

  thumbRow: { marginTop: Spacing.md },
  thumb: {
    width: 64, height: 110, borderRadius: Radius.sm, marginRight: Spacing.sm,
    backgroundColor: Colors.sageTint,
  },

  errorBox: {
    backgroundColor: Colors.errorBg, borderRadius: Radius.sm, padding: Spacing.md,
    marginTop: Spacing.lg, borderLeftWidth: 3, borderLeftColor: Colors.locationPin,
  },
  errorText: { fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.errorText, lineHeight: 18 },

  cta: {
    backgroundColor: Colors.forest, borderRadius: Radius.md, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xl, minHeight: 52,
  },
  ctaDisabled: { backgroundColor: Colors.disabled },
  ctaBusy:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ctaText:     { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.body, color: Colors.sageTint },
});
