// ─── Dynamic Expo config ──────────────────────────────────────────────────────
//
// app.json still holds all the static configuration. This file layers on the
// values that must NOT be committed — currently the Google Maps API key, which
// gets compiled into the native project at build time.
//
// Expo reads app.json first and passes it here as `config`, so everything in
// app.json survives untouched; we only add to it.
//
// The key comes from EXPO_PUBLIC_GOOGLE_PLACES_API_KEY — the same key already
// used for Places search and Geocoding. It needs "Maps SDK for iOS" enabled on
// it in Google Cloud Console, and should be restricted to the app's bundle ID.
//
// Local dev reads it from .env; EAS cloud builds read it from the EAS secret of
// the same name (see `eas env:list --environment production`).
//
// IMPORTANT — the key must reach react-native-maps as a PLUGIN PROP:
//
//   ["react-native-maps", { iosGoogleMapsApiKey: "..." }]
//
// Setting only ios.config.googleMapsApiKey is not enough. The plugin keys its
// entire Google Maps setup off that prop: without it, useGoogleMaps is false,
// so `pod 'react-native-maps/Google'` is never added to the Podfile and
// GMSServices.provideAPIKey() is never added to the AppDelegate. The Google
// Maps SDK then isn't in the binary at all and PROVIDER_GOOGLE renders a blank
// rectangle — which is exactly what build 4 shipped.

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

  // Replace the bare "react-native-maps" entry from app.json with the
  // configured form carrying the key. Written as a map so the plugin keeps its
  // position in the array and the rest of the list is untouched.
  const plugins = (config.plugins ?? []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== 'react-native-maps') return plugin;

    const existingProps = Array.isArray(plugin) ? plugin[1] ?? {} : {};
    return [
      'react-native-maps',
      {
        ...existingProps,
        iosGoogleMapsApiKey:     googleMapsApiKey,
        androidGoogleMapsApiKey: googleMapsApiKey,
      },
    ];
  });

  return {
    ...config,
    plugins,
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
