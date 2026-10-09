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
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';

import { initDb } from '../../lib/db';
import { useNotificationHandlers } from '../../lib/notification-routing';
import { shouldShowOnboarding } from '../../lib/onboarding';
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

  // Reveal the app once both fonts AND the database are ready.
  // Hiding splash before dbReady causes a blank flash between the native
  // splash and the first render (nothing to show until dbReady is true).
  useEffect(() => {
    if ((fontsLoaded || fontError) && dbReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, dbReady]);

  // Request notification permission on every app open when status is still
  // undetermined. Fires once the app is fully ready (fonts + DB) so the dialog
  // appears over a fully-rendered UI rather than a blank screen.
  //
  // allowSound MUST be requested explicitly. Calling requestPermissionsAsync()
  // with no arguments does not reliably include the sound authorisation on iOS,
  // which makes every notification arrive silently no matter what `sound` is set
  // to on the notification itself — that was the cause of the silent alerts.
  useEffect(() => {
    if (!dbReady || (!fontsLoaded && !fontError)) return;
    Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === 'undetermined') {
        console.log('[Notifications] permission undetermined — requesting on launch');
        Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
      } else {
        console.log('[Notifications] permission status on launch:', status);
      }
    });
  }, [dbReady, fontsLoaded, fontError]);

  // Foreground haptics + tap-to-open-the-place. Passed the same readiness flag
  // used below, so a cold-start tap waits for the navigator before routing.
  const navigatorReady = Boolean(fontsLoaded || fontError) && dbReady;
  useNotificationHandlers(navigatorReady);

  // Show the welcome once per install. Runs only after the navigator exists,
  // and only once per launch — the ref stops a re-render from pushing it twice.
  const onboardingChecked = useRef(false);
  useEffect(() => {
    if (!navigatorReady || onboardingChecked.current) return;
    onboardingChecked.current = true;

    shouldShowOnboarding().then((show) => {
      if (show) router.push('/onboarding');
    });
  }, [navigatorReady]);

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

        {/* Bulk import. Pushed rather than modal so the review screen can be
            reached with a back gesture from either entry point. */}
        <Stack.Screen name="add-many" />
        <Stack.Screen name="add-screenshots" />
        <Stack.Screen name="import-review" />
        <Stack.Screen
          name="import-limit"
          options={{ presentation: 'modal', headerShown: false }}
        />

        {/* First-open welcome */}
        <Stack.Screen
          name="onboarding"
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}
