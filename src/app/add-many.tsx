// ─── Add many places ──────────────────────────────────────────────────────────
//
// Entry point for bulk import. The user picks a city or trip, pastes a list of
// place names (or Google Maps links), and sees what it will cost before any
// billed search happens.
//
// All wording comes from lib/import/copy.ts. The logic lives in the import
// modules; this screen only collects input and reports progress.

import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { HowItWorksLink, HowItWorksSheet } from '@/components/how-it-works';
import { COPY } from '../../lib/import/copy';
import { MAX_IMPORT_SIZE, canImport, getImportsRemaining } from '../../lib/import/import-limits';
import { runLookup } from '../../lib/import/import-run';
import { billableLineCount, parseLines } from '../../lib/import/parse-lines';
import { importHandoff } from '../../lib/import/handoff';
import type { Coords } from '../../lib/import/types';
import { WorkerError } from '../../lib/import/worker-client';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

/** Cost of one Places text search, used only for the estimate shown to the user. */
const COST_PER_SEARCH_USD = 0.032;

export default function AddManyScreen() {
  const insets = useSafeAreaInsets();

  const [cityLabel,  setCityLabel]  = useState('');
  const [cityCentre, setCityCentre] = useState<Coords | null>(null);
  const [text,       setText]       = useState('');
  const [busy,       setBusy]       = useState(false);
  const [progress,   setProgress]   = useState<{ done: number; total: number } | null>(null);
  const [error,      setError]      = useState('');
  const [howOpen,    setHowOpen]    = useState(false);

  const [remaining, setRemaining] = useState<number | null>(null);
  React.useEffect(() => { getImportsRemaining().then(setRemaining); }, []);

  // Parsing is cheap and pure, so it can run on every keystroke to keep the
  // count and the estimate live.
  const parsed = useMemo(() => parseLines(text, MAX_IMPORT_SIZE), [text]);
  const billable = billableLineCount(parsed.lines);
  const estimatedCost = billable * COST_PER_SEARCH_USD;

  const handleLookup = useCallback(async () => {
    setError('');

    if (!cityCentre) { setError(COPY.addMany.cityRequired); return; }
    if (parsed.lines.length === 0) { setError(COPY.addMany.emptyInput); return; }

    if (!(await canImport())) {
      router.push('/import-limit');
      return;
    }

    setBusy(true);
    setProgress({ done: 0, total: parsed.lines.length });

    try {
      const rows = await runLookup(parsed.lines, cityCentre, setProgress);
      // Rows are handed over in memory rather than through route params —
      // twenty rows of candidates is far too much to put in a URL.
      importHandoff.set({ rows, cityLabel });
      router.push('/import-review');
    } catch (err) {
      if (err instanceof WorkerError) {
        setError(
          err.kind === 'offline'       ? COPY.errors.offline
          : err.kind === 'rate-limited' ? err.message
          : err.kind === 'config'       ? COPY.errors.generic
          :                               COPY.errors.searchFailed
        );
      } else {
        setError(COPY.errors.searchFailed);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [cityCentre, cityLabel, parsed.lines]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl * 3 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>{COPY.addMany.title}</Text>
          <HowItWorksLink onPress={() => setHowOpen(true)} />
        </View>

        <Text style={styles.intro}>{COPY.addMany.intro}</Text>

        {remaining !== null && remaining <= 1 && (
          <Text style={styles.remaining}>{COPY.limits.remaining(remaining)}</Text>
        )}

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
          onFail={(e) => console.warn('[AddMany] city search failed:', JSON.stringify(e))}
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

        {/* ── The list ── */}
        <Text style={styles.label}>{COPY.addMany.listLabel}</Text>
        <TextInput
          style={styles.textarea}
          value={text}
          onChangeText={setText}
          placeholder={COPY.addMany.listPlaceholder}
          placeholderTextColor={`${Colors.sage}99`}
          multiline
          textAlignVertical="top"
          autoCapitalize="words"
          autoCorrect={false}
        />
        <Text style={styles.hint}>{COPY.addMany.listHint}</Text>

        {parsed.truncated && (
          <Text style={styles.warn}>{COPY.addMany.truncated(MAX_IMPORT_SIZE)}</Text>
        )}

        {/* ── Estimate, shown before anything is billed ── */}
        {parsed.lines.length > 0 && (
          <View style={styles.estimateBox}>
            <Text style={styles.estimateText}>
              {COPY.addMany.estimate(parsed.lines.length, billable)}
            </Text>
            {billable > 0 && (
              <Text style={styles.estimateCost}>
                Estimated cost {estimatedCost < 0.01 ? 'under $0.01' : `$${estimatedCost.toFixed(2)}`}
              </Text>
            )}
          </View>
        )}

        {error.length > 0 && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        <Pressable
          style={[styles.cta, (busy || parsed.lines.length === 0) && styles.ctaDisabled]}
          onPress={handleLookup}
          disabled={busy || parsed.lines.length === 0}
        >
          {busy ? (
            <View style={styles.ctaBusy}>
              <ActivityIndicator color={Colors.sageTint} />
              <Text style={styles.ctaText}>
                {progress
                  ? COPY.progress.searching(progress.done, progress.total)
                  : COPY.progress.saving}
              </Text>
            </View>
          ) : (
            <Text style={styles.ctaText}>
              {parsed.lines.length > 0
                ? COPY.addMany.searchButton(parsed.lines.length)
                : COPY.addMany.searchButtonEmpty}
            </Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.push('/add-screenshots')} style={styles.secondary}>
          <Text style={styles.secondaryText}>{COPY.screenshots.title}</Text>
        </Pressable>
      </ScrollView>

      <HowItWorksSheet visible={howOpen} onClose={() => setHowOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.mist },
  content: { paddingHorizontal: Spacing.xl },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  title: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.screenTitle,
    color:      Colors.ink,
  },
  intro: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  remaining: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.forest,
    marginBottom: Spacing.lg,
  },
  label: {
    fontFamily:    Typography.bodyFont,
    fontSize:      10,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
    marginTop:     Spacing.lg,
  },
  input: {
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
  dropdown: {
    backgroundColor: Colors.white,
    borderWidth:     0.5,
    borderColor:     Colors.sage,
    borderRadius:    Radius.sm,
    maxHeight:       200,
    marginTop:       2,
  },
  why: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    lineHeight: 18,
    marginTop:  Spacing.sm,
  },
  textarea: {
    fontFamily:        Typography.bodyFont,
    fontSize:          FontSize.body,
    color:             Colors.ink,
    backgroundColor:   Colors.white,
    borderWidth:       0.5,
    borderColor:       Colors.sage,
    borderRadius:      Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    minHeight:         160,
    lineHeight:        22,
  },
  hint: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    marginTop:  Spacing.sm,
  },
  warn: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.forest,
    marginTop:  Spacing.sm,
  },
  estimateBox: {
    backgroundColor: Colors.sageTint,
    borderRadius:    Radius.sm,
    padding:         Spacing.md,
    marginTop:       Spacing.lg,
  },
  estimateText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.forest,
    lineHeight: 18,
  },
  estimateCost: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.metadata,
    color:      Colors.forest,
    marginTop:  Spacing.xs,
  },
  errorBox: {
    backgroundColor: Colors.errorBg,
    borderRadius:    Radius.sm,
    padding:         Spacing.md,
    marginTop:       Spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.locationPin,
  },
  errorText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.errorText,
    lineHeight: 18,
  },
  cta: {
    backgroundColor: Colors.forest,
    borderRadius:    Radius.md,
    paddingVertical: 15,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.xl,
    minHeight:       52,
  },
  ctaDisabled: { backgroundColor: Colors.disabled },
  ctaBusy:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ctaText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.sageTint,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    marginTop: Spacing.sm,
  },
  secondaryText: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.forest,
    textDecorationLine: 'underline',
  },
});
