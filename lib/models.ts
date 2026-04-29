// ─── Place ────────────────────────────────────────────────────────────────────

// A single saved location — a restaurant, attraction, hotel, or anything worth visiting
export interface Place {
  // Unique ID generated automatically when the place is saved
  id: string;

  // The display name of the place (e.g. "Eiffel Tower" or "Le Jules Verne")
  name: string;

  // What kind of place this is (e.g. "restaurant", "museum", "park", "hotel")
  category: string;

  // The exact position of the place on the globe
  coordinates: {
    // Latitude — how far north or south the place is (ranges from -90 to 90)
    lat: number;
    // Longitude — how far east or west the place is (ranges from -180 to 180)
    lng: number;
  };

  // An optional personal note the user wrote about this place (e.g. "great pasta, book ahead")
  note: string | null;

  // The confirmed street address from Google Places (e.g. "80 Rue de Rivoli, 75001 Paris")
  address: string | null;

  // The web link where this place was originally found (e.g. an Instagram post or Google Maps link)
  sourceUrl: string | null;

  // How the place was added to the app:
  // "instagram" — pulled from an Instagram post or reel
  // "maps"      — imported from Google Maps or Apple Maps
  // "manual"    — typed in by the user themselves
  sourceType: 'instagram' | 'maps' | 'manual';

  // The exact moment the user saved this place (ISO date string, e.g. "2026-03-28T10:00:00.000Z")
  savedAt: string;
}

// ─── Trip ─────────────────────────────────────────────────────────────────────

// A named travel plan covering a destination and a range of dates
export interface Trip {
  // Unique ID generated automatically when the trip is created
  id: string;

  // A friendly name the user gives the trip (e.g. "Paris Spring 2026")
  name: string;

  // The city or country being visited (e.g. "Paris, France")
  destination: string;

  // The first day of the trip (ISO date string, e.g. "2026-06-01")
  startDate: string;

  // The last day of the trip (ISO date string, e.g. "2026-06-10")
  endDate: string;

  // All the places the user has saved and linked to this trip
  places: Place[];
}

// ─── Day ──────────────────────────────────────────────────────────────────────

// A single day within a trip, with an ordered list of places to visit
export interface Day {
  // Unique ID generated automatically when the day is created
  id: string;

  // The ID of the trip this day belongs to
  tripId: string;

  // The calendar date for this day (ISO date string, e.g. "2026-06-03")
  date: string;

  // The places planned for this day, in the order they will be visited
  places: Place[];
}

// ─── Itinerary ────────────────────────────────────────────────────────────────

// The complete day-by-day schedule for an entire trip
export interface Itinerary {
  // Unique ID generated automatically when the itinerary is created
  id: string;

  // The ID of the trip this itinerary belongs to
  tripId: string;

  // All the days in this itinerary, arranged in chronological order
  days: Day[];
}
