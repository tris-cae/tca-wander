// ─── Places event bus ─────────────────────────────────────────────────────────
//
// A tiny module-level event emitter used to notify any screen that is
// currently mounted that a place was just saved. This sidesteps the problem
// where the save modal sits *on top of* the map/list tabs without causing them
// to blur/re-focus, meaning useFocusEffect never re-fires after a save.
//
// Usage:
//   // Emit (in save.tsx after a successful save):
//   placeSavedEvent.emit();
//
//   // Subscribe (in map.tsx / list.tsx):
//   useEffect(() => {
//     return placeSavedEvent.subscribe(() => reloadPlaces());
//   }, []);

type Listener = () => void;

class PlaceSavedEvent {
  private listeners: Set<Listener> = new Set();

  /** Call this after a place is successfully written to the database. */
  emit() {
    this.listeners.forEach((fn) => fn());
  }

  /**
   * Register a callback that fires whenever a place is saved.
   * Returns an unsubscribe function — pass it to the useEffect cleanup.
   */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const placeSavedEvent = new PlaceSavedEvent();
