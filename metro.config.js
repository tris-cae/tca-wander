// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure Metro resolves native module variants (.ios.js, .native.js) before
// the generic .js and .web.js ones. Without this, running `expo start` without
// an explicit platform flag can cause packages like expo-sqlite to resolve to
// their WASM/web-worker implementation instead of the iOS native module.
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

module.exports = config;
