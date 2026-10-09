// ─── First-open welcome ───────────────────────────────────────────────────────
//
// Shown once per install, including to beta testers who already have the app —
// the flag starts unset for everyone, so their next launch shows it.
//
// Answers the tester note "I can't tell what to do on first open" without
// seeding fake pins: it says what the app is for, then offers the one action
// that fills an empty map.

import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COPY } from '../../lib/import/copy';
import { markOnboardingSeen } from '../../lib/onboarding';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();

  const finish = useCallback(async (next: 'import' | 'skip') => {
    // Marked seen on either route, so dismissing it counts as having seen it
    await markOnboardingSeen();
    if (next === 'import') router.replace('/add-many');
    else                   router.replace('/(tabs)/map');
  }, []);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + Spacing.xl * 3, paddingBottom: insets.bottom + Spacing.xl },
      ]}
    >
      <View style={styles.body}>
        <Text style={styles.title}>{COPY.onboarding.welcomeTitle}</Text>
        <Text style={styles.lede}>{COPY.onboarding.welcomeBody}</Text>
        <Text style={styles.text}>{COPY.onboarding.startBody}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.cta} onPress={() => finish('import')}>
          <Text style={styles.ctaText}>{COPY.onboarding.startButton}</Text>
        </Pressable>

        <Pressable style={styles.secondary} onPress={() => finish('skip')}>
          <Text style={styles.secondaryText}>{COPY.onboarding.skipButton}</Text>
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
  body: { gap: Spacing.lg },
  title: {
    fontFamily: Typography.displayFont,
    fontSize:   32,
    color:      Colors.forest,
  },
  lede: {
    fontFamily: Typography.bodyFont,
    fontSize:   17,
    color:      Colors.ink,
    lineHeight: 26,
  },
  text: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    lineHeight: 21,
  },
  actions: { gap: Spacing.xs },
  cta: {
    backgroundColor: Colors.forest,
    borderRadius:    Radius.md,
    paddingVertical: 15,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       52,
  },
  ctaText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.sageTint,
  },
  secondary:     { alignItems: 'center', paddingVertical: Spacing.md },
  secondaryText: { fontFamily: Typography.bodyFont, fontSize: FontSize.body, color: Colors.sage },
});
