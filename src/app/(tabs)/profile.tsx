import Slider from '@react-native-community/slider';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../../lib/theme';
import {
  DEFAULT_RADIUS_M,
  getNotificationRadius,
  getNotificationsEnabled,
  getUseFeet,
  setNotificationRadius,
  setNotificationsEnabled,
  setUseFeet,
} from '../../../lib/settings';

// ─── Unit conversion ──────────────────────────────────────────────────────────

const M_PER_FOOT = 0.3048;

function metresToFeet(m: number): number { return m / M_PER_FOOT; }
function feetToMetres(ft: number): number { return ft * M_PER_FOOT; }

// ─── Slider range ─────────────────────────────────────────────────────────────
// Internal storage is always metres. Slider range adapts to chosen unit.

const MIN_M  = 100;
const MAX_M  = 2000;
const STEP_M = 50;

// Foot range: ~300 ft (≈91 m) to ~6 600 ft (≈2 011 m), 50 ft steps
const MIN_FT  = 300;
const MAX_FT  = 6600;
const STEP_FT = 50;

// ─── Reference labels ─────────────────────────────────────────────────────────

interface RefEntry { fromFt: number; label: string; }

const REF_LABELS: RefEntry[] = [
  { fromFt:    0, label: 'about a short stroll away' },
  { fromFt:  100, label: 'about half a city block' },
  { fromFt:  250, label: 'roughly one city block' },
  { fromFt:  400, label: 'about 2 city blocks' },
  { fromFt:  700, label: 'a short 3-min walk' },
  { fromFt: 1200, label: 'about 5 min walking' },
  { fromFt: 2500, label: 'about 10 min walking' },
  { fromFt: 4000, label: 'roughly a 15-min walk' },
];

function getReferenceLabel(metres: number): string {
  const ft = metresToFeet(metres);
  let entry = REF_LABELS[0];
  for (const e of REF_LABELS) { if (ft >= e.fromFt) entry = e; }
  return entry.label;
}

// ─── Tick marks ───────────────────────────────────────────────────────────────

const METRE_TICKS = [100, 500, 1000, 1500, 2000];
const FOOT_TICKS  = [300, 1650, 3300, 5000, 6600];

// ─── Display label ────────────────────────────────────────────────────────────

function displayLabel(metres: number, useFeet: boolean): string {
  if (useFeet) {
    const ft = Math.round(metresToFeet(metres) / STEP_FT) * STEP_FT;
    if (ft >= 5280) {
      const miles = ft / 5280;
      const q = Math.round(miles * 4);
      if (q === 1) return '¼ mi';
      if (q === 2) return '½ mi';
      if (q === 3) return '¾ mi';
      return `${miles.toFixed(1)} mi`;
    }
    return `${ft.toLocaleString()} ft`;
  }
  return metres < 1000
    ? `${metres} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  // ── Settings state ─────────────────────────────────────────────────────────

  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [radiusM,               setRadiusM]                  = useState(DEFAULT_RADIUS_M);
  const [useFeetState,          setUseFeetState2]            = useState(false);
  const [loaded,                setLoaded]                   = useState(false);

  // ── Load persisted values on mount ─────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      getNotificationsEnabled(),
      getNotificationRadius(),
      getUseFeet(),
    ]).then(([enabled, radius, feet]) => {
      setNotificationsEnabledState(enabled);
      setRadiusM(radius);
      setUseFeetState2(feet);
      setLoaded(true);
    });
  }, []);

  // ── Write-through handlers ──────────────────────────────────────────────────

  const handleToggle = useCallback((value: boolean) => {
    setNotificationsEnabledState(value);
    setNotificationsEnabled(value);
  }, []);

  const handleRadiusChange = useCallback((value: number) => {
    const metres = useFeetState
      ? Math.round(feetToMetres(value))
      : Math.round(value);
    setRadiusM(metres);
  }, [useFeetState]);

  const handleRadiusSlidingComplete = useCallback((value: number) => {
    const metres = useFeetState
      ? Math.round(feetToMetres(value))
      : Math.round(value);
    setRadiusM(metres);
    setNotificationRadius(metres);
  }, [useFeetState]);

  const handleUnitToggle = useCallback(() => {
    const next = !useFeetState;
    setUseFeetState2(next);
    setUseFeet(next);
  }, [useFeetState]);

  // ── Derived display values ─────────────────────────────────────────────────

  // Slider operates in the chosen unit; convert from stored metres.
  const sliderValue = useFeetState
    ? Math.round(metresToFeet(radiusM) / STEP_FT) * STEP_FT
    : Math.round(radiusM / STEP_M) * STEP_M;

  const referenceLabel = getReferenceLabel(radiusM);

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

        {/* ── Proximity Notifications section ── */}
        <Text style={styles.sectionLabel}>Proximity notifications</Text>

        <View style={styles.settingsCard}>

          {/* ── Enable toggle ── */}
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

          {/* ── Radius row: label + current value + ft/m toggle ── */}
          <View style={[styles.row, !notificationsEnabled && styles.rowDisabled]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Alert radius</Text>
              <Text style={styles.rowSubtitle}>
                How close before a notification fires
              </Text>
            </View>

            {/* Value + unit-toggle pill */}
            <View style={styles.radiusRight}>
              <Text style={styles.radiusValue}>
                {displayLabel(radiusM, useFeetState)}
              </Text>
              {/* Tapping the pill switches between ft and m */}
              <TouchableOpacity
                style={styles.unitToggle}
                onPress={handleUnitToggle}
                activeOpacity={0.7}
                hitSlop={8}
                disabled={!notificationsEnabled}
              >
                <Text style={styles.unitToggleText}>
                  {useFeetState ? 'switch to m' : 'switch to ft'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Slider ── */}
          <View style={[!notificationsEnabled && styles.rowDisabled]}>
            <Slider
              style={styles.slider}
              minimumValue={useFeetState ? MIN_FT  : MIN_M}
              maximumValue={useFeetState ? MAX_FT  : MAX_M}
              step={        useFeetState ? STEP_FT : STEP_M}
              value={sliderValue}
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

            {/* ── Tick marks ── */}
            <View style={styles.tickRow}>
              {(useFeetState ? FOOT_TICKS : METRE_TICKS).map((v) => (
                <Text key={v} style={styles.tick}>
                  {useFeetState
                    ? v >= 5280
                      ? `${(v / 5280).toFixed(1)}mi`
                      : `${Math.round(v / 100) / 10}k ft`
                    : v >= 1000
                      ? `${v / 1000}km`
                      : `${v}m`
                  }
                </Text>
              ))}
            </View>

            {/* ── Real-world reference label — DM Sans 12 px sage ── */}
            {notificationsEnabled && (
              <Text style={styles.referenceLabel}>
                {displayLabel(radiusM, useFeetState)} — {referenceLabel}
              </Text>
            )}
          </View>

        </View>

        {/* ── About section ── */}
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
    fontFamily:   Typography.bodyFontMedium,
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
    fontSize:      10,
    color:         Colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
    marginTop:     Spacing.lg,
  },

  // ── Settings card ──────────────────────────────────────────────────────────

  settingsCard: {
    backgroundColor:   Colors.white,
    borderRadius:      Radius.md,
    borderWidth:       0.5,
    borderColor:       Colors.sage,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.sm,
  },

  // ── Row ────────────────────────────────────────────────────────────────────

  row: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: Spacing.sm,
    gap:             Spacing.md,
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

  // ── Radius value + unit toggle ─────────────────────────────────────────────

  radiusRight: {
    alignItems: 'flex-end',
    gap:        4,
  },

  radiusValue: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.forest,
    minWidth:   60,
    textAlign:  'right',
  },

  // Tap to toggle between ft and m
  unitToggle: {
    backgroundColor:   Colors.sageTint,
    borderRadius:      Radius.lg,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },

  unitToggleText: {
    fontFamily:    Typography.bodyFont,
    fontSize:      10,
    color:         Colors.forest,
    letterSpacing: 0.2,
  },

  divider: {
    height:          StyleSheet.hairlineWidth,
    backgroundColor: Colors.sageTint,
    marginVertical:  Spacing.xs,
  },

  // ── Slider ─────────────────────────────────────────────────────────────────

  slider: {
    marginHorizontal: -8,
    height:           40,
  },

  tickRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.xs,
    marginBottom:      4,
  },

  tick: {
    fontFamily: Typography.bodyFont,
    fontSize:   10,
    color:      `${Colors.sage}99`,
  },

  // DM Sans 12 px sage — updates live as the slider moves
  referenceLabel: {
    fontFamily:   Typography.bodyFont,
    fontSize:     12,
    color:        Colors.sage,
    textAlign:    'center',
    marginBottom: Spacing.xs,
    lineHeight:   17,
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
