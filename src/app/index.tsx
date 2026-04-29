import { Redirect } from 'expo-router';

// The root route (/) immediately redirects to the Map tab.
// This ensures the map is always the first screen the user sees.
export default function Index() {
  return <Redirect href="/map" />;
}
