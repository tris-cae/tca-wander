// ─── App Design Tokens ────────────────────────────────────────────────────────
//
// Single source of truth for every visual constant in the app.
// Import from here instead of hardcoding values in individual screens.
//
// Font loading: the fontFamily strings below are only valid after
// useFonts() has run in src/app/_layout.tsx. React Native falls back
// to the system font automatically if a font hasn't loaded yet.

// ─── Colours ──────────────────────────────────────────────────────────────────

export const Colors = {
  /** Warm off-white — default card and screen background */
  mist: '#F4F6F2',

  /** Very light sage tint — selected state, pill backgrounds, active vibe button */
  sageTint: '#E8EDE6',

  /** Mid sage green — primary accent, category labels, slider thumb, active borders */
  sage: '#8FA888',

  /** Deep forest green — primary action buttons (Generate Route, CTAs) */
  forest: '#4A7046',

  /** Near-black with a green undertone — all body text and headings */
  ink: '#1F2B1E',

  /** Pure white — surfaces that need full contrast against mist or sage backgrounds */
  white: '#FFFFFF',

  /** Warm orange — user location dot on the map, validation error accents */
  locationPin: '#E05C2A',

  /** Muted sage-grey — disabled state for primary action buttons */
  disabled: '#A0AFA0',

  /** Very light blush — background tint for error/warning banners */
  errorBg: '#FDECEA',

  /** Dark burnt-red — body text inside error banners */
  errorText: '#7A2810',
} as const;

// ─── Typography — font families ───────────────────────────────────────────────

export const Typography = {
  /** Libre Baskerville 400 — elegant serif for display headings and pull-quotes */
  displayFont: 'LibreBaskerville_400Regular',

  /** DM Sans 400 — clean geometric sans-serif for body copy and UI labels */
  bodyFont: 'DMSans_400Regular',

  /** DM Sans 500 — slightly heavier weight for sub-labels, tab items, and metadata */
  bodyFontMedium: 'DMSans_500Medium',
} as const;

// ─── Typography — font sizes ──────────────────────────────────────────────────

export const FontSize = {
  /** Screen-level headings — "Route", "Map", page titles */
  screenTitle: 28,

  /** Card and section headings — place names, itinerary stop titles */
  cardHeader: 20,

  /** General body text — descriptions, reasons, notes */
  body: 15,

  /** Small supporting information — categories, durations, timestamps */
  metadata: 12,
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const Spacing = {
  /** 4 pt — tight internal gaps, icon-to-label padding */
  xs: 4,

  /** 8 pt — gaps between related elements inside a card */
  sm: 8,

  /** 12 pt — standard internal card padding, between label and value */
  md: 12,

  /** 16 pt — outer card margin, section separation */
  lg: 16,

  /** 24 pt — screen horizontal padding, large section gaps */
  xl: 24,
} as const;

// ─── Border radius ────────────────────────────────────────────────────────────

export const Radius = {
  /** 8 pt — small chips, badges, tight pills */
  sm: 8,

  /** 12 pt — standard cards, input fields, inline buttons */
  md: 12,

  /** 20 pt — large cards, bottom sheets, prominent action buttons */
  lg: 20,
} as const;
