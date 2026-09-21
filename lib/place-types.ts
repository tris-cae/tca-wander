// ─── Google place types → readable category ───────────────────────────────────
//
// Google returns a `types` array on every autocomplete prediction, e.g.
// ["cafe", "food", "point_of_interest", "establishment"]. The useful entry is
// buried among generic ones that describe every business on Earth.
//
// This picks the most specific meaningful type and phrases it for display, so a
// search result can read "Café · 12 Rue de Buci" instead of just a bare name.

/** Types that apply to nearly everything and say nothing useful on their own. */
const GENERIC = new Set([
  'point_of_interest',
  'establishment',
  'food',
  'premise',
  'geocode',
  'political',
  'street_address',
  'route',
  'locality',
  'store',           // too vague on its own; a more specific *_store usually exists
  'health',
  'finance',
]);

/** Hand-written labels where the raw type would read badly. */
const LABELS: Record<string, string> = {
  cafe:               'Café',
  bar:                'Bar',
  restaurant:         'Restaurant',
  bakery:             'Bakery',
  night_club:         'Nightclub',
  meal_takeaway:      'Takeaway',
  meal_delivery:      'Delivery',
  museum:             'Museum',
  art_gallery:        'Gallery',
  tourist_attraction: 'Attraction',
  park:               'Park',
  zoo:                'Zoo',
  aquarium:           'Aquarium',
  library:            'Library',
  book_store:         'Bookshop',
  clothing_store:     'Clothing',
  shopping_mall:      'Shopping centre',
  supermarket:        'Supermarket',
  convenience_store:  'Corner shop',
  department_store:   'Department store',
  lodging:            'Hotel',
  spa:                'Spa',
  gym:                'Gym',
  beauty_salon:       'Salon',
  movie_theater:      'Cinema',
  stadium:            'Stadium',
  amusement_park:     'Theme park',
  church:             'Church',
  mosque:             'Mosque',
  synagogue:          'Synagogue',
  hindu_temple:       'Temple',
  university:         'University',
  school:             'School',
  hospital:           'Hospital',
  pharmacy:           'Pharmacy',
  bank:               'Bank',
  airport:            'Airport',
  train_station:      'Train station',
  subway_station:     'Metro station',
  bus_station:        'Bus station',
  parking:            'Parking',
};

/** Turns "clothing_store" into "Clothing store" as a last resort. */
function prettify(type: string): string {
  const words = type.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Returns a short human-readable category for a Google prediction, or null when
 * the types array carries nothing worth showing.
 *
 * @param types The `types` array from an autocomplete prediction or place details
 */
export function placeTypeLabel(types: string[] | undefined): string | null {
  if (!types || types.length === 0) return null;

  // Prefer a type we have a hand-written label for — these read best
  for (const t of types) {
    if (LABELS[t]) return LABELS[t];
  }

  // Otherwise the first type that isn't generic boilerplate
  for (const t of types) {
    if (!GENERIC.has(t)) return prettify(t);
  }

  return null;
}
