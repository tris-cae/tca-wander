import AppTabs from '@/components/app-tabs';

// This layout renders the four-tab shell (Map, List, Route, Profile).
// It lives inside a root Stack so that push screens (e.g. /save) can
// slide over the top of the tabs without replacing them.
export default function TabsLayout() {
  return <AppTabs />;
}
