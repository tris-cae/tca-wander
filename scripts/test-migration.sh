#!/bin/bash
# Migration test for Notice Explore: updatedAt + soft delete.
#
# Simulates a beta tester's existing phone database (old schema, real rows with
# old-style IDs), applies the exact migration statements from lib/db.ts, and
# asserts that nothing was lost and the new columns are correct.
set -u

DB=/tmp/notice-migration-test.db
rm -f "$DB"
PASS=0; FAIL=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1))
  else echo "  FAIL  $1 — got [$2] expected [$3]"; FAIL=$((FAIL+1)); fi
}

echo "=== 1. Build a tester's existing database (pre-migration schema) ==="
sqlite3 "$DB" <<'SQL'
PRAGMA journal_mode = WAL;
CREATE TABLE places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, address TEXT, note TEXT,
  sourceUrl TEXT, sourceType TEXT NOT NULL, savedAt TEXT NOT NULL
);
ALTER TABLE places ADD COLUMN visited INTEGER NOT NULL DEFAULT 0;
CREATE TABLE notification_log (placeId TEXT PRIMARY KEY, lastNotifiedAt TEXT NOT NULL);

-- Old-style IDs exactly as generateId() used to produce them
INSERT INTO places VALUES
 ('m9x2k1a7bq3','Café de Flore','Café',48.8542,2.3320,'172 Bd Saint-Germain','great coffee',NULL,'manual','2026-08-01T10:00:00.000Z',0),
 ('m9x2k1b8cr4','Shakespeare & Co','Bookshop',48.8526,2.3470,'37 Rue de la Bûcherie',NULL,NULL,'manual','2026-08-02T11:30:00.000Z',1),
 ('m9x2k1c9ds5','Parc Monceau','Park',48.8799,2.3090,NULL,'sunny spot',NULL,'manual','2026-09-15T08:15:00.000Z',0);
INSERT INTO notification_log VALUES ('m9x2k1a7bq3','2026-09-20T12:00:00.000Z');
SQL
BEFORE_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")
BEFORE_IDS=$(sqlite3 "$DB" "SELECT group_concat(id) FROM (SELECT id FROM places ORDER BY id);")
echo "  rows before: $BEFORE_COUNT"

echo
echo "=== 2. Apply the migration (exact statements from lib/db.ts) ==="
sqlite3 "$DB" "ALTER TABLE places ADD COLUMN updatedAt TEXT;" 2>/dev/null
sqlite3 "$DB" "UPDATE places SET updatedAt = savedAt WHERE updatedAt IS NULL;"
sqlite3 "$DB" "ALTER TABLE places ADD COLUMN deletedAt TEXT;" 2>/dev/null
sqlite3 "$DB" "CREATE INDEX IF NOT EXISTS idx_places_live ON places (deletedAt) WHERE deletedAt IS NULL;"
echo "  migration applied"

echo
echo "=== 3. Nothing lost ==="
check "row count unchanged" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")" "$BEFORE_COUNT"
check "every ID preserved byte-for-byte" \
      "$(sqlite3 "$DB" "SELECT group_concat(id) FROM (SELECT id FROM places ORDER BY id);")" "$BEFORE_IDS"
check "name/note/address intact" \
      "$(sqlite3 "$DB" "SELECT name||'|'||COALESCE(note,'~')||'|'||COALESCE(address,'~') FROM places WHERE id='m9x2k1a7bq3';")" \
      "Café de Flore|great coffee|172 Bd Saint-Germain"
check "visited flag preserved" \
      "$(sqlite3 "$DB" "SELECT visited FROM places WHERE id='m9x2k1b8cr4';")" "1"
check "notification_log link still resolves" \
      "$(sqlite3 "$DB" "SELECT p.name FROM places p JOIN notification_log n ON n.placeId=p.id;")" \
      "Café de Flore"

echo
echo "=== 4. New columns correct ==="
check "updatedAt backfilled per-row from its own savedAt" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE updatedAt = savedAt;")" "3"
check "no NULL updatedAt remains" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE updatedAt IS NULL;")" "0"
check "distinct updatedAt values (not one migration timestamp)" \
      "$(sqlite3 "$DB" "SELECT COUNT(DISTINCT updatedAt) FROM places;")" "3"
check "all rows start live (deletedAt NULL)" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE deletedAt IS NULL;")" "3"
check "partial index created" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_places_live';")" "1"

echo
echo "=== 5. Idempotent (migration runs on every app launch) ==="
sqlite3 "$DB" "ALTER TABLE places ADD COLUMN updatedAt TEXT;" 2>/dev/null
sqlite3 "$DB" "UPDATE places SET updatedAt = savedAt WHERE updatedAt IS NULL;"
sqlite3 "$DB" "ALTER TABLE places ADD COLUMN deletedAt TEXT;" 2>/dev/null
sqlite3 "$DB" "CREATE INDEX IF NOT EXISTS idx_places_live ON places (deletedAt) WHERE deletedAt IS NULL;"
check "second run leaves row count alone" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")" "3"
check "second run does not clobber an edited updatedAt" \
      "$(sqlite3 "$DB" "UPDATE places SET updatedAt='2026-10-06T09:00:00.000Z' WHERE id='m9x2k1c9ds5';
          UPDATE places SET updatedAt = savedAt WHERE updatedAt IS NULL;
          SELECT updatedAt FROM places WHERE id='m9x2k1c9ds5';")" \
      "2026-10-06T09:00:00.000Z"

echo
echo "=== 6. Soft delete behaves like a delete to the app ==="
sqlite3 "$DB" "UPDATE places SET deletedAt='2026-10-06T10:00:00.000Z', updatedAt='2026-10-06T10:00:00.000Z' WHERE id='m9x2k1b8cr4';"
check "getAllPlaces-equivalent hides it" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE deletedAt IS NULL;")" "2"
check "getPlace-equivalent returns nothing for it" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE id='m9x2k1b8cr4' AND deletedAt IS NULL;")" "0"
check "row survives for future sync" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE id='m9x2k1b8cr4';")" "1"
check "nearby-search-equivalent excludes it" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE lat BETWEEN 48.0 AND 49.0 AND lng BETWEEN 2.0 AND 3.0 AND deletedAt IS NULL;")" "2"

echo
echo "=== 7. Old and new IDs coexist ==="
sqlite3 "$DB" "INSERT INTO places (id,name,category,lat,lng,address,note,sourceUrl,sourceType,savedAt,updatedAt,visited)
  VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d479','New Place','Bar',48.86,2.35,NULL,NULL,NULL,'maps','2026-10-06T11:00:00.000Z','2026-10-06T11:00:00.000Z',0);"
check "UUID row inserts alongside legacy IDs" \
      "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE deletedAt IS NULL;")" "3"
check "legacy ID still readable after UUID row added" \
      "$(sqlite3 "$DB" "SELECT name FROM places WHERE id='m9x2k1a7bq3';")" "Café de Flore"

echo
echo "────────────────────────────────────"
echo "  $PASS passed, $FAIL failed"
rm -f "$DB" "$DB-wal" "$DB-shm"
[ "$FAIL" -eq 0 ]
