import {
  LibreBaskerville_400Regular,
  LibreBaskerville_400Regular_Italic,
  LibreBaskerville_700Bold,
} from '@expo-google-fonts/libre-baskerville';
import {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { initDb } from '../../lib/db';
// Importing this module registers the background location task with TaskManager.
// It must be imported here (at the root layout) so the task is defined before
// any navigation or component rendering happens.
import '../../lib/background-location-task';
import { AnimatedSplashOverlay } from '@/components/animated-icon';

// Keep the native splash visible until custom fonts are registered.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Track database readiness separately from font loading.
  // Screens must not mount until this is true — any call to getAllPlaces()
  // or savePlace() before initDb() resolves will throw "Database not initialised".
  const [dbReady, setDbReady] = useState(false);

  // Load all custom font variants once at app startup.
  const [fontsLoaded, fontError] = useFonts({
    LibreBaskerville_400Regular,
    LibreBaskerville_400Regular_Italic,
    LibreBaskerville_700Bold,
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  // Initialise the SQLite database once when the app first loads.
  // We set dbReady=true even on error so the app can still render —
  // individual screens will show their own error states if the DB is broken.
  useEffect(() => {
    initDb()
      .then(() => {
        console.log('[DB] initDb complete — database is ready');
        setDbReady(true);
      })
      .catch((err) => {
        console.error('[DB] Failed to initialise database:', err);
        setDbReady(true);
      });
  }, []);

  // Reveal the app once fonts are ready (or immediately on error so the
  // UI still appears — React Native falls back to the system font).
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Bug 8 — Request notification permission on every app open when status is
  // still undetermined. Fires once the app is fully ready (fonts + DB) so the
  // dialog appears over a fully-rendered UI rather than a blank screen.
  useEffect(() => {
    if (!dbReady || (!fontsLoaded && !fontError)) return;
    Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === 'undetermined') {
        console.log('[Notifications] permission undetermined — requesting on launch');
        Notifications.requestPermissionsAsync();
      } else {
        console.log('[Notifications] permission status on launch:', status);
      }
    });
  }, [dbReady, fontsLoaded, fontError]);

  // Hold the entire render until both fonts AND the database are ready.
  // This is the critical guard — without it, tab screens race against initDb().
  if ((!fontsLoaded && !fontError) || !dbReady) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/*
        Root Stack — sits above the tab navigator so that push screens
        (e.g. /save) can slide over the tabs without replacing them.
      */}
      <Stack screenOptions={{ headerShown: false }}>
        {/* The four-tab shell (Map, List, Route, Profile) */}
        <Stack.Screen name="(tabs)" />
        {/* Save-a-destination form — slides up as a modal sheet */}
        <Stack.Screen
          name="save"
          options={{ presentation: 'modal', headerShown: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}
