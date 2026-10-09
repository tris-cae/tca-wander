// ─── Every word the import feature shows the user ─────────────────────────────
//
// All user-facing text lives here so it can be read and edited in one place
// without going near screen code. Screens import from this file and never
// hard-code a string.
//
// Voice: quiet and plain. No exclamation marks. Say what happens, not how
// pleased we are about it. Prefer a short sentence to a clever one.

export const COPY = {

  // ── Add many places ────────────────────────────────────────────────────────

  addMany: {
    title: 'Add many places',

    intro:
      'Paste a list of places, one per line, and Notice will look each one up ' +
      'so you can check it before saving.',

    cityLabel: 'City or trip',

    cityPlaceholder: 'Choose where these places are',

    // Shown under the city picker — explains why it is required
    cityWhy:
      'Choosing this first matters. The same name turns up in dozens of cities, ' +
      'so knowing where to look is what gets you the right Café Central.',

    listLabel: 'Places',

    // Shown inside the empty text box
    listPlaceholder:
      'Café Central\n' +
      'Sobrino de Botín\n' +
      'Mercado de San Miguel',

    // Small print under the text box
    listHint: 'One per line. You can paste a Google Maps link on a line too.',

    // Button label, with the count filled in
    searchButton:      (n: number) => `Look up ${n} ${n === 1 ? 'place' : 'places'}`,
    searchButtonEmpty: 'Look up places',

    // Shown before searching so the user knows the size of what they started
    estimate: (lines: number, billable: number) => {
      if (billable === 0) {
        return `${lines} ${lines === 1 ? 'line' : 'lines'}, nothing to look up — ` +
               `the links already include their locations.`;
      }
      const free = billable === lines
        ? ''
        : ` The other ${lines - billable} already include their locations.`;
      return `${lines} ${lines === 1 ? 'line' : 'lines'}, ` +
             `${billable} to look up.${free}`;
    },

    // Shown when the paste was longer than the cap
    truncated: (cap: number) =>
      `Only the first ${cap} lines were kept. You can bring the rest over separately.`,

    cityRequired: 'Choose a city or trip first, so we know where to look.',

    emptyInput: 'Add at least one place.',
  },

  // ── Screenshot import ──────────────────────────────────────────────────────
  // Deliberately framed around where people actually collect places. Does not
  // mention Google Maps as a source.

  screenshots: {
    title: 'Add from screenshots',

    intro:
      'Screenshots of Instagram posts, TikTok captions, your notes or an article. ' +
      'Notice reads the place names and looks them up.',

    hint:
      'Up to five at a time. Clear shots where the place names are readable work ' +
      'best. Nothing is saved until you have reviewed it.',

    pickButton:     'Choose screenshots',
    pickedCount:    (n: number) => `${n} ${n === 1 ? 'screenshot' : 'screenshots'} selected`,
    readingButton:  'Reading screenshots',

    noneFound:
      'No place names were readable in those screenshots. A clearer shot, or ' +
      'typing the names in, will work better.',

    tooMany: (cap: number) => `Up to ${cap} screenshots at a time.`,

    failed:
      'Those screenshots could not be read just now. You can try again, or type ' +
      'the names in instead.',
  },

  // ── Review screen ──────────────────────────────────────────────────────────

  review: {
    title: 'Check before saving',

    intro:
      'Tap any row to see other matches. Unticked rows will not be saved.',

    // Row badges
    notFound:      "Couldn't find this",
    uncertainRead: 'Check this one — it was hard to read',
    duplicate:     (name: string, m: number) => `Already saved as ${name}, ${m} m away`,
    badLink:       "Couldn't read this link",

    otherMatches:  (n: number) => `${n} other ${n === 1 ? 'match' : 'matches'}`,
    searchAgain:   'Search again',
    searchAgainPlaceholder: 'Try different words',

    saveButton:      (n: number) => `Save ${n} ${n === 1 ? 'place' : 'places'}`,
    saveButtonEmpty: 'Nothing selected',

    savedToast: (n: number) => `${n} ${n === 1 ? 'place' : 'places'} saved`,

    nothingChecked:
      'Nothing is ticked, so there is nothing to save yet.',
  },

  // ── Progress ───────────────────────────────────────────────────────────────

  progress: {
    searching: (done: number, total: number) => `Finding ${done} of ${total} places`,
    reading:   (n: number) => `Reading ${n} ${n === 1 ? 'screenshot' : 'screenshots'}`,
    saving:    'Saving',
  },

  // ── Limits ─────────────────────────────────────────────────────────────────

  limits: {
    // Shown when the user has used their bulk imports
    reachedTitle: 'You have used your bulk imports',

    reachedBody:
      'Bulk importing is limited while Notice is in beta. You can still add ' +
      'places one at a time, as many as you like — the plus button on the map.',

    reachedButton: 'Add a single place',

    // Shown before the last one is used
    remaining: (n: number) =>
      n === 1
        ? 'This is your last bulk import for now.'
        : `${n} bulk imports left.`,
  },

  // ── Errors ─────────────────────────────────────────────────────────────────

  errors: {
    offline:
      'No connection. Looking places up needs the internet — your saved places ' +
      'still work offline.',

    searchFailed:
      'The lookup did not finish. Nothing was saved, so you can try again.',

    saveFailed:
      'Those places could not be saved. Nothing was written, so nothing is ' +
      'half-done.',

    generic:
      'Something went wrong. Nothing was saved.',
  },

  // ── How it works ───────────────────────────────────────────────────────────
  // Reachable from a link on each screen, not a one-time popup.

  howItWorks: {
    linkLabel: 'How it works',
    title:     'How adding many places works',

    sections: [
      {
        heading: 'Choose where first',
        body:
          'Picking a city or trip tells Notice where to look. Without it, a ' +
          'search for a common name could land anywhere in the world.',
      },
      {
        heading: 'One place per line',
        body:
          'Type or paste names, one on each line. A Google Maps link on a line ' +
          'works too — Notice reads the location straight from it.',
      },
      {
        heading: 'Screenshots',
        body:
          'Screenshots of Instagram posts, TikTok captions, your notes or an ' +
          'article. Notice reads the names it can see. Clear shots work best.',
      },
      {
        heading: 'You check everything',
        body:
          'Nothing is saved until you have looked at it. Each row shows the ' +
          'closest match; tap a row to see the others and pick a different one. ' +
          'Untick anything you do not want.',
      },
      {
        heading: 'Places already saved',
        body:
          'If something looks like a place you have already saved, it is ' +
          'flagged rather than skipped, so the choice stays yours.',
      },
    ],
  },

  // ── First-open onboarding ──────────────────────────────────────────────────

  onboarding: {
    welcomeTitle: 'Notice Explore',

    welcomeBody:
      'A quiet place for the places you want to remember. Save somewhere, and ' +
      'Notice will tap you on the shoulder when you are near it again.',

    startBody:
      'If you already keep a list somewhere, you can bring it over now. ' +
      'Or skip this and start with the first place you find.',

    startButton: 'Add some places',
    skipButton:  'Skip for now',
  },

  // ── Privacy policy ─────────────────────────────────────────────────────────
  // Added to docs/privacy.html, not shown in the app.

  privacyLine:
    'Screenshots you choose to import are sent to a third-party AI service ' +
    '(Anthropic) to read the place names in them. The images are processed to ' +
    'return those names and are not stored by Notice Explore.',

} as const;
