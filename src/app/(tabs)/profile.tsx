import Slider from '@react-native-community/slider';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../../lib/theme';
import {
  DEFAULT_RADIUS_M,
  getNotificationRadius,
  getNotificationsEnabled,
  setNotificationRadius,
  setNotificationsEnabled,
} from '../../../lib/settings';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  // ── Settings state ─────────────────────────────────────────────────────────

  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [radiusM,               setRadiusM]                  = useState(DEFAULT_RADIUS_M);
  const [loaded,                setLoaded]                   = useState(false);

  // ── Load persisted values on mount ─────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      getNotificationsEnabled(),
      getNotificationRadius(),
    ]).then(([enabled, radius]) => {
      setNotificationsEnabledState(enabled);
      setRadiusM(radius);
      setLoaded(true);
    });
  }, []);

  // ── Write-through handlers ──────────────────────────────────────────────────
  // Update React state immediately for a responsive UI, then persist async.

  const handleToggle = useCallback((value: boolean) => {
    setNotificationsEnabledState(value);
    setNotificationsEnabled(value);
  }, []);

  const handleRadiusChange = useCallback((value: number) => {
    setRadiusM(Math.round(value));
  }, []);

  const handleRadiusSlidingComplete = useCallback((value: number) => {
    const rounded = Math.round(value);
    setRadiusM(rounded);
    setNotificationRadius(rounded);
  }, []);

  // ── Radius display label ───────────────────────────────────────────────────

  const radiusLabel =
    radiusM < 1000
      ? `${radiusM} m`
      : `${(radiusM / 1000).toFixed(1)} km`;

  // Don't flash stale defaults before loading completes
  if (!loaded) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop:    insets.top + Spacing.xl,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Screen title ── */}
        <Text style={styles.screenTitle}>Profile</Text>
        <Text style={styles.screenSubtitle}>
          Manage your notification preferences
        </Text>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* ── Proximity Notifications section ── */}
        {/* ─────────────────────────────────────────────────────────────────── */}

        <Text style={styles.sectionLabel}>Proximity notifications</Text>

        <View style={styles.settingsCard}>

          {/* Toggle row */}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Enable proximity alerts</Text>
              <Text style={styles.rowSubtitle}>
                Notify me when I'm near a saved place
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggle}
              trackColor={{ false: Colors.sageTint, true: Colors.forest }}
              thumbColor={Colors.white}
              ios_backgroundColor={Colors.sageTint}
            />
          </View>

          <View style={styles.divider} />

          {/* Radius row */}
          <View style={[styles.row, !notificationsEnabled && styles.rowDisabled]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Alert radius</Text>
              <Text style={styles.rowSubtitle}>
                How close before a notification fires
              </Text>
            </View>
            <Text style={styles.radiusValue}>{radiusLabel}</Text>
          </View>

          <Slider
            style={styles.slider}
            minimumValue={100}
            maximumValue={2000}
            step={50}
            value={radiusM}
            onValueChange={handleRadiusChange}
            onSlidingComplete={handleRadiusSlidingComplete}
            minimumTrackTintColor={
              notificationsEnabled ? Colors.forest : Colors.sageTint
            }
            maximumTrackTintColor={Colors.sageTint}
            thumbTintColor={
              notificationsEnabled ? Colors.forest : Colors.sage
            }
            disabled={!notificationsEnabled}
          />

          {/* Tick marks */}
          <View style={styles.tickRow}>
            <Text style={styles.tick}>100 m</Text>
            <Text style={styles.tick}>500 m</Text>
            <Text style={styles.tick}>1 km</Text>
            <Text style={styles.tick}>1.5 km</Text>
            <Text style={styles.tick}>2 km</Text>
          </View>

        </View>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* ── About section ── */}
        {/* ─────────────────────────────────────────────────────────────────── */}

        <Text style={styles.sectionLabel}>About</Text>

        <View style={styles.settingsCard}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Saved places</Text>
            <Text style={styles.aboutNote}>
              Notifications use a 24-hour cooldown per place so you're never
              spammed.
            </Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  root: {
    flex: 1,
    backgroundColor: Colors.mist,
  },

  content: {
    paddingHorizontal: Spacing.xl,
  },

  // ── Header ─────────────────────────────────────────────────────────────────

  screenTitle: {
    fontFamily:   Typography.displayFont,
    fontSize:     FontSize.screenTitle,
    color:        Colors.ink,
    marginBottom: Spacing.xs,
  },

  screenSubtitle: {
    fontFamily:   Typography.bodyFont,
    fontSize:     FontSize.body,
    color:        Colors.sage,
    lineHeight:   22,
    marginBottom: Spacing.xl,
  },

  // ── Section label ──────────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily:    Typography.bodyFont,
    fontSize:      11,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom:  Spacing.sm,
    marginTop:     Spacing.lg,
  },

  // ── Settings card ──────────────────────────────────────────────────────────

  settingsCard: {
    backgroundColor: Colors.white,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.sage,
    paddingHorizontal: Spacing.lg,
    paddingTop:      Spacing.md,
    paddingBottom:   Spacing.sm,
  },

  // ── Row ────────────────────────────────────────────────────────────────────

  row: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    gap:            Spacing.md,
  },

  rowDisabled: {
    opacity: 0.4,
  },

  rowText: {
    flex: 1,
  },

  rowTitle: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.ink,
  },

  rowSubtitle: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    lineHeight: 18,
    marginTop:  2,
  },

  radiusValue: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.forest,
    minWidth:   52,
    textAlign:  'right',
  },

  divider: {
    height:            StyleSheet.hairlineWidth,
    backgroundColor:   Colors.sageTint,
    marginVertical:    Spacing.xs,
  },

  // ── Slider ─────────────────────────────────────────────────────────────────

  slider: {
    marginHorizontal: -8,
    height:           40,
  },

  tickRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    marginBottom:   Spacing.xs,
  },

  tick: {
    fontFamily: Typography.bodyFont,
    fontSize:   10,
    color:      `${Colors.sage}99`,
  },

  // ── About section ──────────────────────────────────────────────────────────

  aboutNote: {
    flex:       1,
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    lineHeight: 18,
  },
});
