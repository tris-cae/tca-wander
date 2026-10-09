// ─── Bulk import types ────────────────────────────────────────────────────────
//
// Shared shapes for the import pipeline. Kept free of React and SQLite so every
// stage can be tested on its own.

/** A coordinate pair, matching the shape used by Place. */
export interface Coords {
  lat: number;
  lng: number;
}

/**
 * One line the user typed or one name read from a screenshot, before any
 * searching has happened.
 */
export interface ImportLine {
  /** Position in the original input, used to keep rows in the user's order. */
  index: number;
  /** The raw text of the line, exactly as entered. */
  raw: string;
  /** What this line is: a place name to search for, or a pasted Maps link. */
  kind: 'name' | 'link';
  /** Search text — the name itself, or the name pulled out of a link. */
  query: string;
  /** Coordinates read straight from a Maps link. Null for a plain name. */
  coords: Coords | null;
  /** Set when a link was recognised but unusable, e.g. no coordinates in it. */
  error: string | null;
  /**
   * True when the text came from a screenshot and the model flagged it as hard
   * to read, so the review screen can tell the user to check it.
   */
  uncertain?: boolean;
}

/** One candidate match returned by a Places search. */
export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
  coords: Coords;
  /** Short category label derived from Google's types array, when available. */
  category: string | null;
}

/** Why a row might need the user's attention before saving. */
export type RowFlag =
  | { type: 'not-found' }
  | { type: 'bad-link';  message: string }
  | { type: 'duplicate'; existingName: string; metres: number }
  | { type: 'uncertain-read' };

/** One row on the review screen. */
export interface ReviewRow {
  line: ImportLine;
  /** Every match the search returned, best first. Empty when nothing matched. */
  candidates: PlaceCandidate[];
  /** Index into `candidates` the user has chosen. -1 when there is no match. */
  selectedIndex: number;
  /** Whether this row will be saved. */
  checked: boolean;
  /** Anything the user should notice before saving. */
  flags: RowFlag[];
}
