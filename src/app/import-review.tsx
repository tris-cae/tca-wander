// ─── Review before saving ─────────────────────────────────────────────────────
//
// Shared by typed entry and screenshot import. One row per line: the match we
// think is right, with a tick. Tapping a row opens the other matches so the
// user can pick a different one, or search again with different words.
//
// Nothing is written until Save is pressed, and then everything goes in one
// transaction.

import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HowItWorksLink, HowItWorksSheet } from '@/components/how-it-works';
import { COPY } from '../../lib/import/copy';
import { importHandoff } from '../../lib/import/handoff';
import { recordImportUsed } from '../../lib/import/import-limits';
import { checkedCount, commitImport } from '../../lib/import/import-run';
import { pickBestMatch } from '../../lib/import/match-picking';
import type { ReviewRow } from '../../lib/import/types';
import { searchPlaces, WorkerError } from '../../lib/import/worker-client';
import { placeSavedEvent } from '../../lib/places-event';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

export default function ImportReviewScreen() {
  const insets = useSafeAreaInsets();

  // Taken once on mount; the handoff slot is cleared by take() so going back
  // and forward cannot resurrect stale rows.
  const initial = useMemo(() => importHandoff.take(), []);

  const [rows,      setRows]      = useState<ReviewRow[]>(initial?.rows ?? []);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [howOpen,   setHowOpen]   = useState(false);
  const [openRow,   setOpenRow]   = useState<number | null>(null);

  const cityLabel = initial?.cityLabel ?? '';
  const selected  = checkedCount(rows);

  const toggleRow = useCallback((index: number) => {
    setRows((prev) => prev.map((r, i) =>
      i === index && r.selectedIndex >= 0 ? { ...r, checked: !r.checked } : r
    ));
  }, []);

  const chooseCandidate = useCallback((rowIndex: number, candidateIndex: number) => {
    setRows((prev) => prev.map((r, i) =>
      i === rowIndex ? { ...r, selectedIndex: candidateIndex, checked: true } : r
    ));
    setOpenRow(null);
  }, []);

  const replaceCandidates = useCallback((rowIndex: number, row: ReviewRow) => {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? row : r)));
  }, []);

  const handleSave = useCallback(async () => {
    if (selected === 0) { setError(COPY.review.nothingChecked); return; }

    setSaving(true);
    setError('');
    try {
      const saved = await commitImport(rows, cityLabel);
      if (saved.length > 0) {
        // Only a completed write spends one of the user's bulk imports
        await recordImportUsed();
        placeSavedEvent.emit();
      }
      router.replace('/(tabs)/map');
    } catch (err) {
      console.error('[ImportReview] save failed:', err);
      setError(COPY.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [rows, cityLabel, selected]);

  if (rows.length === 0) {
    return (
      <View style={[styles.root, styles.centre]}>
        <Text style={styles.emptyText}>{COPY.errors.generic}</Text>
        <Pressable style={styles.cta} onPress={() => router.back()}>
          <Text style={styles.ctaText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={rows}
        keyExtractor={(_, i) => String(i)}
        // 100+ rows must stay smooth; windowing keeps only what is visible mounted
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{
          paddingTop:    insets.top + Spacing.lg,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: Spacing.xl,
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{COPY.review.title}</Text>
              <HowItWorksLink onPress={() => setHowOpen(true)} />
            </View>
            <Text style={styles.intro}>{COPY.review.intro}</Text>
            {cityLabel.length > 0 && <Text style={styles.city}>{cityLabel}</Text>}
          </View>
        }
        renderItem={({ item, index }) => (
          <ReviewRowCard
            row={item}
            onToggle={() => toggleRow(index)}
            onOpen={() => setOpenRow(index)}
          />
        )}
      />

      {/* ── Save bar ── */}
      <View style={[styles.saveBar, { paddingBottom: insets.bottom + Spacing.md }]}>
        {error.length > 0 && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          style={[styles.cta, (saving || selected === 0) && styles.ctaDisabled]}
          onPress={handleSave}
          disabled={saving || selected === 0}
        >
          {saving
            ? <ActivityIndicator color={Colors.sageTint} />
            : <Text style={styles.ctaText}>
                {selected > 0 ? COPY.review.saveButton(selected) : COPY.review.saveButtonEmpty}
              </Text>}
        </Pressable>
      </View>

      {openRow !== null && (
        <CandidatePicker
          row={rows[openRow]}
          onChoose={(ci) => chooseCandidate(openRow, ci)}
          onReplace={(r) => replaceCandidates(openRow, r)}
          onClose={() => setOpenRow(null)}
        />
      )}

      <HowItWorksSheet visible={howOpen} onClose={() => setHowOpen(false)} />
    </View>
  );
}

// ─── One row ──────────────────────────────────────────────────────────────────

function ReviewRowCard({
  row, onToggle, onOpen,
}: {
  row: ReviewRow;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const chosen    = row.selectedIndex >= 0 ? row.candidates[row.selectedIndex] : null;
  const others    = Math.max(0, row.candidates.length - 1);
  const notFound  = row.flags.some((f) => f.type === 'not-found');
  const badLink   = row.flags.find((f) => f.type === 'bad-link');
  const duplicate = row.flags.find((f) => f.type === 'duplicate');
  const uncertain = row.flags.some((f) => f.type === 'uncertain-read');

  return (
    <Pressable style={styles.card} onPress={onOpen} disabled={row.candidates.length === 0}>
      <Pressable
        style={[styles.checkbox, row.checked && styles.checkboxOn]}
        onPress={onToggle}
        hitSlop={10}
        disabled={row.selectedIndex < 0}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.checked }}
      >
        {row.checked && <Text style={styles.checkmark}>✓</Text>}
      </Pressable>

      <View style={styles.cardBody}>
        <Text style={styles.typed} numberOfLines={1}>{row.line.raw.trim()}</Text>

        {chosen ? (
          <>
            <Text style={styles.matchName} numberOfLines={1}>{chosen.name}</Text>
            {chosen.address && (
              <Text style={styles.matchAddress} numberOfLines={1}>{chosen.address}</Text>
            )}
          </>
        ) : (
          <Text style={styles.notFound}>
            {badLink && badLink.type === 'bad-link' ? badLink.message : COPY.review.notFound}
          </Text>
        )}

        <View style={styles.badges}>
          {uncertain && <Badge text={COPY.review.uncertainRead} tone="warn" />}
          {duplicate && duplicate.type === 'duplicate' && (
            <Badge text={COPY.review.duplicate(duplicate.existingName, duplicate.metres)} tone="warn" />
          )}
          {others > 0 && !notFound && <Badge text={COPY.review.otherMatches(others)} tone="quiet" />}
        </View>
      </View>
    </Pressable>
  );
}

function Badge({ text, tone }: { text: string; tone: 'warn' | 'quiet' }) {
  return (
    <View style={[styles.badge, tone === 'warn' ? styles.badgeWarn : styles.badgeQuiet]}>
      <Text style={[styles.badgeText, tone === 'warn' && styles.badgeTextWarn]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// ─── Other matches ────────────────────────────────────────────────────────────

function CandidatePicker({
  row, onChoose, onReplace, onClose,
}: {
  row: ReviewRow;
  onChoose: (candidateIndex: number) => void;
  onReplace: (row: ReviewRow) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [term,     setTerm]     = useState(row.line.query);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  const searchAgain = useCallback(async () => {
    if (term.trim().length === 0) return;
    setBusy(true); setErr('');
    try {
      const candidates = await searchPlaces(term.trim(), null);
      const picked = pickBestMatch(candidates, term.trim(), null);
      onReplace({
        ...row,
        line: { ...row.line, query: term.trim() },
        candidates: picked.ordered,
        selectedIndex: picked.selectedIndex,
        checked: picked.selectedIndex >= 0,
        flags: picked.selectedIndex < 0 ? [{ type: 'not-found' }] : [],
      });
      if (picked.selectedIndex >= 0) onClose();
    } catch (e) {
      setErr(e instanceof WorkerError ? e.message : COPY.errors.searchFailed);
    } finally {
      setBusy(false);
    }
  }, [term, row, onReplace, onClose]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <FlatList
          data={row.candidates}
          keyExtractor={(c, i) => `${c.placeId ?? 'none'}-${i}`}
          contentContainerStyle={{
            paddingTop: Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
            paddingHorizontal: Spacing.xl,
          }}
          ListHeaderComponent={
            <View>
              <Text style={styles.sheetTitle}>{row.line.raw.trim()}</Text>

              <View style={styles.searchAgainRow}>
                <TextInput
                  style={styles.searchAgainInput}
                  value={term}
                  onChangeText={setTerm}
                  placeholder={COPY.review.searchAgainPlaceholder}
                  placeholderTextColor={`${Colors.sage}99`}
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={searchAgain}
                />
                <Pressable style={styles.searchAgainBtn} onPress={searchAgain} disabled={busy}>
                  {busy
                    ? <ActivityIndicator color={Colors.sageTint} size="small" />
                    : <Text style={styles.searchAgainText}>{COPY.review.searchAgain}</Text>}
                </Pressable>
              </View>

              {err.length > 0 && <Text style={styles.errorText}>{err}</Text>}
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable
              style={[styles.option, index === row.selectedIndex && styles.optionOn]}
              onPress={() => onChoose(index)}
            >
              <Text style={styles.optionName}>{item.name}</Text>
              {item.address && <Text style={styles.optionAddress}>{item.address}</Text>}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.notFound}>{COPY.review.notFound}</Text>}
        />

        <Pressable
          style={[styles.cta, { marginHorizontal: Spacing.xl, marginBottom: insets.bottom + Spacing.lg }]}
          onPress={onClose}
        >
          <Text style={styles.ctaText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.mist },
  centre: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },

  header:   { marginBottom: Spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title:    { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.screenTitle, color: Colors.ink },
  intro:    { fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.sage, lineHeight: 18, marginTop: Spacing.xs },
  city:     { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.metadata, color: Colors.forest, marginTop: Spacing.sm },

  card: {
    flexDirection:   'row',
    backgroundColor: Colors.white,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.sage,
    padding:         Spacing.md,
    marginBottom:    Spacing.sm,
    gap:             Spacing.md,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: Colors.sage,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: Colors.forest, borderColor: Colors.forest },
  checkmark:  { color: Colors.white, fontSize: 14, lineHeight: 16 },

  cardBody:     { flex: 1 },
  typed:        { fontFamily: Typography.bodyFont, fontSize: 10, color: Colors.sage, textTransform: 'uppercase', letterSpacing: 0.6 },
  matchName:    { fontFamily: Typography.displayFont, fontSize: FontSize.body, color: Colors.ink, marginTop: 3 },
  matchAddress: { fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.sage, marginTop: 2 },
  notFound:     { fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.errorText, marginTop: 3 },

  badges:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  badge:     { borderRadius: Radius.lg, paddingHorizontal: Spacing.sm, paddingVertical: 2, maxWidth: '100%' },
  badgeWarn: { backgroundColor: Colors.errorBg },
  badgeQuiet:{ backgroundColor: Colors.sageTint },
  badgeText: { fontFamily: Typography.bodyFont, fontSize: 10, color: Colors.forest },
  badgeTextWarn: { color: Colors.errorText },

  saveBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.mist,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.sageTint,
  },

  cta: {
    backgroundColor: Colors.forest, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center', minHeight: 52,
  },
  ctaDisabled: { backgroundColor: Colors.disabled },
  ctaText:     { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.body, color: Colors.sageTint },

  errorText: { fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.errorText, marginBottom: Spacing.sm },
  emptyText: { fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.sage, textAlign: 'center' },

  sheet:      { flex: 1, backgroundColor: Colors.mist },
  sheetTitle: { fontFamily: Typography.displayFont, fontSize: FontSize.cardHeader, color: Colors.ink, marginBottom: Spacing.lg },

  searchAgainRow:   { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  searchAgainInput: {
    flex: 1, fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.ink,
    backgroundColor: Colors.white, borderWidth: 0.5, borderColor: Colors.sage,
    borderRadius: Radius.sm, paddingHorizontal: Spacing.md, height: 44,
  },
  searchAgainBtn: {
    backgroundColor: Colors.forest, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.lg, height: 44, alignItems: 'center', justifyContent: 'center', minWidth: 110,
  },
  searchAgainText: { fontFamily: Typography.bodyFontMedium, fontSize: FontSize.metadata, color: Colors.sageTint },

  option:       { backgroundColor: Colors.white, borderRadius: Radius.sm, borderWidth: 0.5, borderColor: Colors.sage, padding: Spacing.md, marginBottom: Spacing.sm },
  optionOn:     { borderColor: Colors.forest, borderWidth: 1.5, backgroundColor: Colors.sageTint },
  optionName:   { fontFamily: Typography.displayFont, fontSize: FontSize.body, color: Colors.ink },
  optionAddress:{ fontFamily: Typography.bodyFont, fontSize: FontSize.metadata, color: Colors.sage, marginTop: 2 },
});
