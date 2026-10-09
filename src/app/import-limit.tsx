// ─── Bulk import allowance used up ────────────────────────────────────────────
//
// Shown instead of the import screen once a device has used its bulk imports.
// Points at single-place saving, which is never limited, rather than leaving
// the user at a dead end.

import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COPY } from '../../lib/import/copy';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

export default function ImportLimitScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.xl * 2, paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={styles.body}>
        <Text style={styles.title}>{COPY.limits.reachedTitle}</Text>
        <Text style={styles.text}>{COPY.limits.reachedBody}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.cta}
          onPress={() => router.replace('/save')}
        >
          <Text style={styles.ctaText}>{COPY.limits.reachedButton}</Text>
        </Pressable>

        <Pressable style={styles.secondary} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>Go back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor:   Colors.mist,
    paddingHorizontal: Spacing.xl,
    justifyContent:    'space-between',
  },
  body: { gap: Spacing.md },
  title: {
    fontFamily: Typography.displayFont,
    fontSize:   FontSize.cardHeader,
    color:      Colors.ink,
  },
  text: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    lineHeight: 22,
  },
  actions: { gap: Spacing.sm },
  cta: {
    backgroundColor: Colors.forest,
    borderRadius:    Radius.md,
    paddingVertical: 15,
    alignItems:      'center',
    minHeight:       52,
    justifyContent:  'center',
  },
  ctaText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.sageTint,
  },
  secondary:     { alignItems: 'center', paddingVertical: Spacing.md },
  secondaryText: { fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.forest },
});
