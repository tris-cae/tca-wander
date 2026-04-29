import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';

import { Colors } from '../../lib/theme';

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={Colors.white}
      indicatorColor={Colors.sageTint}
      labelStyle={{
        selected: { color: Colors.forest },
        default:  { color: Colors.sage },
      }}>

      {/* Map — full-screen Apple MapKit view, default tab */}
      <NativeTabs.Trigger name="map" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" />
      </NativeTabs.Trigger>

      {/* List — searchable list of all saved places */}
      <NativeTabs.Trigger name="list">
        <NativeTabs.Trigger.Label>List</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" />
      </NativeTabs.Trigger>

      {/* Route — day-by-day trip itinerary builder */}
      <NativeTabs.Trigger name="route">
        <NativeTabs.Trigger.Label>Route</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="arrow.triangle.turn.up.right.diamond" />
      </NativeTabs.Trigger>

      {/* Profile — user settings and trip history */}
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person" />
      </NativeTabs.Trigger>

    </NativeTabs>
  );
}
