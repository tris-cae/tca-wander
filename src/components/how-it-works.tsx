// ─── "How it works" sheet ─────────────────────────────────────────────────────
//
// Reachable from a link on every import screen, at any time — deliberately not
// a one-time popup that teaches you something once and then vanishes when you
// actually need it.

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COPY } from '../../lib/import/copy';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

export function HowItWorksLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button">
      <Text style={styles.link}>{COPY.howItWorks.linkLabel}</Text>
    </Pressable>
  );
}

export function HowItWorksSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <ScrollView
          contentContainerStyle={[
            styles.sheetContent,
            { paddingTop: Spacing.xl, paddingBottom: insets.bottom + Spacing.xl * 2 },
          ]}
        >
          <Text style={styles.sheetTitle}>{COPY.howItWorks.title}</Text>

          {COPY.howItWorks.sections.map((section) => (
            <View key={section.heading} style={styles.section}>
              <Text style={styles.sectionHeading}>{section.heading}</Text>
              <Text style={styles.sectionBody}>{section.body}</Text>
            </View>
          ))}
        </ScrollView>

        <Pressable
          style={[styles.closeButton, { marginBottom: insets.bottom + Spacing.lg }]}
          onPress={onClose}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  link: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    textDecorationLine: 'underline',
  },
  sheet: {
    flex: 1,
    backgroundColor: Colors.mist,
  },
  sheetContent: {
    paddingHorizontal: Spacing.xl,
  },
  sheetTitle: {
    fontFamily:   Typography.displayFont,
    fontSize:     FontSize.cardHeader,
    color:        Colors.ink,
    marginBottom: Spacing.xl,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeading: {
    fontFamily:   Typography.bodyFontMedium,
    fontSize:     FontSize.body,
    color:        Colors.forest,
    marginBottom: Spacing.xs,
  },
  sectionBody: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.ink,
    lineHeight: 21,
  },
  closeButton: {
    marginHorizontal: Spacing.xl,
    backgroundColor:  Colors.forest,
    borderRadius:     Radius.md,
    paddingVertical:  14,
    alignItems:       'center',
  },
  closeButtonText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.sageTint,
  },
});
