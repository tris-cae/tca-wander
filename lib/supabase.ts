// ─── Supabase client ──────────────────────────────────────────────────────────
//
// The single connection to the server that holds accounts, synced places and
// shared lists. Everything that talks to the server goes through this object.
//
// IMPORTANT — this module must never be imported by background-location-task.ts.
// That task wakes up when the app is closed, and it must stay a pure SQLite
// reader: fast, offline, and with nothing that can hang on a network call. A
// proximity alert that waits on a server round-trip is a proximity alert that
// fires after you have walked past the place. Sync happens in the foreground,
// in lib/sync.ts, and never from the background task.
//
// The key below is the PUBLISHABLE key and is meant to ship inside the app. It
// grants nothing on its own: every table has Row Level Security, so this key
// can only ever see what the signed-in user is allowed to see, and nothing at
// all when signed out. The secret key must never appear in this project.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Same reasoning as the Google Maps key in app.config.js: a missing value
  // here fails later as a confusing network error, so complain at startup
  // instead, where the cause is obvious.
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
    'is not set — signing in will fail.'
  );
}

export const supabase = createClient(url ?? '', key ?? '', {
  auth: {
    // Keeps the session on the device so the user stays signed in across
    // app launches. Without this they would sign in again every cold start.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,

    // A web-only behaviour: the browser build reads tokens out of the page URL.
    // There is no page URL here, and leaving it on makes the client look for
    // `window.location` that does not exist.
    detectSessionInUrl: false,

    // PKCE is the flow designed for apps that cannot keep a secret — which is
    // every phone app. The browser hands back a short-lived code rather than a
    // token, and the code is worthless without a verifier held only on this
    // device. Used by the Google sign-in flow in lib/auth.tsx.
    flowType: 'pkce',
  },
});

// ─── Token refresh while the app is in use ────────────────────────────────────
//
// Access tokens last an hour. The client refreshes them on a timer, but a timer
// in a backgrounded app is unreliable — iOS suspends it, and it can fire on a
// dead clock after the phone wakes. So the refresh loop is tied to whether the
// app is actually on screen: running while in use, stopped otherwise. On return
// to the foreground the client refreshes immediately if the token went stale.

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
