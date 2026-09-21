// ─── Dynamic Expo config ──────────────────────────────────────────────────────
//
// app.json still holds all the static configuration. This file layers on the
// values that must NOT be committed — currently the Google Maps API key, which
// gets baked into Info.plist at build time.
//
// Expo reads app.json first and passes it here as `config`, so everything in
// app.json survives untouched; we only add to it.
//
// The key comes from EXPO_PUBLIC_GOOGLE_PLACES_API_KEY — the same key already
// used for Places search and Geocoding. It needs "Maps SDK for iOS" enabled on
// it in Google Cloud Console, and should be restricted to the app's bundle ID.
//
// Local dev reads it from .env; EAS cloud builds read it from the EAS secret of
// the same name (see `eas secret:list`).

export default ({ config }) => {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

  if (!googleMapsApiKey) {
    // A missing key produces a blank grey map rather than a crash, which is
    // miserable to debug — so say so loudly at config time instead.
    console.warn(
      '[app.config] EXPO_PUBLIC_GOOGLE_PLACES_API_KEY is not set — ' +
      'the Google map will render blank.'
    );
  }

  return {
    ...config,
    ios: {
      ...config.ios,
      config: {
        ...config.ios?.config,
        googleMapsApiKey,
      },
    },
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        googleMaps: { apiKey: googleMapsApiKey },
      },
    },
  };
};
