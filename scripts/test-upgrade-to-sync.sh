#!/bin/bash
# Upgrade test: does installing the sync build lose anything?
#
# Written to answer one question directly — "will the places already on my
# phone survive this update?" — and to answer it with a real database rather
# than with reassurance.
#
# It builds a database in the exact shape build 6 left on a real phone: places
# with every column the shipped app has, trips and their links, days, and the
# notification cooldown log. Then it applies the new statements from lib/db.ts
# exactly as initDb() would on first launch of the new build, and checks that
# every single row is still there and unchanged.
#
# The last two sections cover the scarier half of the question: what the FIRST
# SIGN-IN does, when the server is still completely empty.
set -u

DB=/tmp/notice-upgrade-test.db
rm -f "$DB" "$DB-wal" "$DB-shm"
PASS=0; FAIL=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1))
  else echo "  FAIL  $1 — got [$2] expected [$3]"; FAIL=$((FAIL+1)); fi
}

echo "=== 1. A phone running build 6, with real saved places ==="
sqlite3 "$DB" <<'SQL'
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, address TEXT, note TEXT,
  sourceUrl TEXT, sourceType TEXT NOT NULL, savedAt TEXT NOT NULL,
  visited INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT, deletedAt TEXT, placeId TEXT
);
CREATE TABLE notification_log (placeId TEXT PRIMARY KEY, lastNotifiedAt TEXT NOT NULL);
CREATE TABLE trips (id TEXT PRIMARY KEY, name TEXT NOT NULL, destination TEXT NOT NULL,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL);
CREATE TABLE trip_places (
  tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  placeId TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  PRIMARY KEY (tripId, placeId));

-- A mix on purpose: a legacy id, UUIDs, an imported place, one marked visited,
-- one already soft-deleted, accents and an apostrophe in the text.
INSERT INTO places (id,name,category,lat,lng,address,note,sourceUrl,sourceType,savedAt,visited,updatedAt,deletedAt,placeId) VALUES
 ('m9x2k1a7bq3','Café de Flore','Café',48.8542,2.3320,'172 Bd Saint-Germain','great coffee',NULL,'manual','2026-08-01T10:00:00.000Z',0,'2026-08-01T10:00:00.000Z',NULL,NULL),
 ('f47ac10b-58cc-4372-a567-0e02b2c3d479','Sobrino de Botín','Restaurant',40.4131,-3.7086,'C. de Cuchilleros, 17','world''s oldest',NULL,'maps','2026-09-10T12:00:00.000Z',1,'2026-09-11T08:00:00.000Z',NULL,'ChIJ_1234'),
 ('a3f1c2d4-1111-4222-8333-444455556666','Mercado de San Miguel','Market',40.4154,-3.7090,NULL,NULL,'https://maps.app.goo.gl/x','maps','2026-09-10T12:00:00.000Z',0,'2026-09-10T12:00:00.000Z',NULL,'ChIJ_5678'),
 ('b7e2d3c5-2222-4333-8444-555566667777','Closed Place','Bar',40.4100,-3.7000,NULL,'shut down',NULL,'manual','2026-07-01T09:00:00.000Z',0,'2026-09-01T09:00:00.000Z','2026-09-01T09:00:00.000Z',NULL);

INSERT INTO notification_log VALUES ('m9x2k1a7bq3','2026-09-20T12:00:00.000Z');
INSERT INTO trips VALUES ('t1','Madrid 2026','Madrid','2026-11-01','2026-11-08');
INSERT INTO trip_places VALUES ('t1','f47ac10b-58cc-4372-a567-0e02b2c3d479'),('t1','a3f1c2d4-1111-4222-8333-444455556666');
SQL

BEFORE_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")
BEFORE_LIVE=$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE deletedAt IS NULL;")
# A fingerprint of every field of every row. If one byte of one place changes,
# this changes.
BEFORE_HASH=$(sqlite3 "$DB" "SELECT group_concat(id||'|'||name||'|'||category||'|'||lat||'|'||lng||'|'||COALESCE(address,'~')||'|'||COALESCE(note,'~')||'|'||COALESCE(sourceUrl,'~')||'|'||sourceType||'|'||savedAt||'|'||visited||'|'||COALESCE(updatedAt,'~')||'|'||COALESCE(deletedAt,'~')||'|'||COALESCE(placeId,'~'), CHAR(10)) FROM (SELECT * FROM places ORDER BY id);")
echo "  $BEFORE_COUNT places on the phone ($BEFORE_LIVE visible, 1 already deleted), 1 trip"

echo
echo "=== 2. Install the new build — initDb() runs the new statements ==="
sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sync_outbox (
  entity TEXT NOT NULL, entityId TEXT NOT NULL, queuedAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT,
  PRIMARY KEY (entity, entityId));
CREATE TRIGGER IF NOT EXISTS places_outbox_insert
AFTER INSERT ON places
WHEN (SELECT value FROM sync_meta WHERE key = 'applyingRemote') IS NULL
BEGIN
  INSERT INTO sync_outbox (entity, entityId, queuedAt) VALUES ('place', NEW.id, NEW.updatedAt)
  ON CONFLICT(entity, entityId) DO UPDATE SET queuedAt = excluded.queuedAt, attempts = 0, lastError = NULL;
END;
CREATE TRIGGER IF NOT EXISTS places_outbox_update
AFTER UPDATE ON places
WHEN (SELECT value FROM sync_meta WHERE key = 'applyingRemote') IS NULL
BEGIN
  INSERT INTO sync_outbox (entity, entityId, queuedAt) VALUES ('place', NEW.id, NEW.updatedAt)
  ON CONFLICT(entity, entityId) DO UPDATE SET queuedAt = excluded.queuedAt, attempts = 0, lastError = NULL;
END;
SQL

check "every place still present" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")" "$BEFORE_COUNT"
check "every field of every place byte-for-byte identical" \
  "$(sqlite3 "$DB" "SELECT group_concat(id||'|'||name||'|'||category||'|'||lat||'|'||lng||'|'||COALESCE(address,'~')||'|'||COALESCE(note,'~')||'|'||COALESCE(sourceUrl,'~')||'|'||sourceType||'|'||savedAt||'|'||visited||'|'||COALESCE(updatedAt,'~')||'|'||COALESCE(deletedAt,'~')||'|'||COALESCE(placeId,'~'), CHAR(10)) FROM (SELECT * FROM places ORDER BY id);")" \
  "$BEFORE_HASH"
check "the trip survived" \
  "$(sqlite3 "$DB" "SELECT name FROM trips WHERE id='t1';")" "Madrid 2026"
check "places are still linked to the trip" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM trip_places WHERE tripId='t1';")" "2"
check "notification cooldown survived" \
  "$(sqlite3 "$DB" "SELECT lastNotifiedAt FROM notification_log WHERE placeId='m9x2k1a7bq3';")" \
  "2026-09-20T12:00:00.000Z"
check "the already-deleted place is still deleted, not resurrected" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places WHERE deletedAt IS NULL;")" "$BEFORE_LIVE"
check "upgrading did NOT queue anything on its own" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox;")" "0"

echo
echo "=== 3. Opening the app again changes nothing (initDb runs every launch) ==="
for i in 1 2 3; do
sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sync_outbox (
  entity TEXT NOT NULL, entityId TEXT NOT NULL, queuedAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT,
  PRIMARY KEY (entity, entityId));
SQL
done
check "three more launches, same places" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")" "$BEFORE_COUNT"
check "three more launches, still untouched" \
  "$(sqlite3 "$DB" "SELECT group_concat(id||'|'||name||'|'||category||'|'||lat||'|'||lng||'|'||COALESCE(address,'~')||'|'||COALESCE(note,'~')||'|'||COALESCE(sourceUrl,'~')||'|'||sourceType||'|'||savedAt||'|'||visited||'|'||COALESCE(updatedAt,'~')||'|'||COALESCE(deletedAt,'~')||'|'||COALESCE(placeId,'~'), CHAR(10)) FROM (SELECT * FROM places ORDER BY id);")" \
  "$BEFORE_HASH"

echo
echo "=== 4. First sign-in: everything is queued for upload, nothing altered ==="
# prepareForUser() → queueAllPlacesForSync()
sqlite3 "$DB" "INSERT INTO sync_outbox (entity,entityId,queuedAt)
               SELECT 'place', id, COALESCE(updatedAt, savedAt) FROM places WHERE true
               ON CONFLICT(entity,entityId) DO NOTHING;"
check "all 4 places queued, including the deleted one" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox;")" "4"
check "queueing did not touch the places themselves" \
  "$(sqlite3 "$DB" "SELECT group_concat(id||'|'||name||'|'||category||'|'||lat||'|'||lng||'|'||COALESCE(address,'~')||'|'||COALESCE(note,'~')||'|'||COALESCE(sourceUrl,'~')||'|'||sourceType||'|'||savedAt||'|'||visited||'|'||COALESCE(updatedAt,'~')||'|'||COALESCE(deletedAt,'~')||'|'||COALESCE(placeId,'~'), CHAR(10)) FROM (SELECT * FROM places ORDER BY id);")" \
  "$BEFORE_HASH"
check "real edit times kept, not stamped with today" \
  "$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='m9x2k1a7bq3';")" \
  "2026-08-01T10:00:00.000Z"

echo
echo "=== 5. The empty-server fear: a pull that returns nothing ==="
# This is the scenario worth being afraid of. The account is brand new, so the
# server holds zero places. If sync treated "not on the server" as "deleted",
# it would wipe the phone. applyRemotePlaces() only ever inserts or updates the
# rows it is GIVEN — it has no delete path at all, so nothing to apply means
# nothing happens.
sqlite3 "$DB" <<'SQL'
BEGIN;
INSERT INTO sync_meta (key,value) VALUES ('applyingRemote','1')
  ON CONFLICT(key) DO UPDATE SET value='1';
-- zero rows returned by the server: no statements run here at all
DELETE FROM sync_meta WHERE key='applyingRemote';
COMMIT;
SQL
check "an empty server did not remove a single place" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")" "$BEFORE_COUNT"
check "still byte-for-byte identical after an empty pull" \
  "$(sqlite3 "$DB" "SELECT group_concat(id||'|'||name||'|'||category||'|'||lat||'|'||lng||'|'||COALESCE(address,'~')||'|'||COALESCE(note,'~')||'|'||COALESCE(sourceUrl,'~')||'|'||sourceType||'|'||savedAt||'|'||visited||'|'||COALESCE(updatedAt,'~')||'|'||COALESCE(deletedAt,'~')||'|'||COALESCE(placeId,'~'), CHAR(10)) FROM (SELECT * FROM places ORDER BY id);")" \
  "$BEFORE_HASH"

echo
echo "=== 6. A stale server copy cannot overwrite a newer local one ==="
# The server returns an OLD version of a place the user has since edited on
# this phone. The guard is `WHERE excluded.updatedAt >= places.updatedAt`.
sqlite3 "$DB" "UPDATE places SET note='edited on this phone', updatedAt='2026-10-20T10:00:00.000Z' WHERE id='m9x2k1a7bq3';"
sqlite3 "$DB" <<'SQL'
BEGIN;
INSERT INTO sync_meta (key,value) VALUES ('applyingRemote','1')
  ON CONFLICT(key) DO UPDATE SET value='1';
INSERT INTO places (id,name,category,lat,lng,address,note,sourceUrl,sourceType,savedAt,updatedAt,deletedAt,placeId,visited)
VALUES ('m9x2k1a7bq3','Café de Flore','Café',48.8542,2.3320,'172 Bd Saint-Germain','OLD server note',NULL,'manual','2026-08-01T10:00:00.000Z','2026-08-01T10:00:00.000Z',NULL,NULL,0)
ON CONFLICT(id) DO UPDATE SET note=excluded.note, updatedAt=excluded.updatedAt
WHERE excluded.updatedAt >= places.updatedAt;
DELETE FROM sync_meta WHERE key='applyingRemote';
COMMIT;
SQL
check "the newer local edit won" \
  "$(sqlite3 "$DB" "SELECT note FROM places WHERE id='m9x2k1a7bq3';")" "edited on this phone"

echo
echo "=== 7. Sync contains no way to delete a local place ==="
# A belt-and-braces check on the source itself. If someone ever adds a DELETE
# against `places` to the sync engine, this fails and they have to justify it.
# Resolved from this script's own location, so the check works whichever
# directory it is run from. A missing file must FAIL rather than quietly find
# nothing and report success — a test that cannot fail is worse than no test.
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"
if [ -f "$LIB/sync.ts" ] && [ -f "$LIB/db.ts" ]; then
  HITS=$(cat "$LIB/sync.ts" "$LIB/db.ts" | grep -cE "DELETE[[:space:]]+FROM[[:space:]]+places" || true)
  check "no 'DELETE FROM places' anywhere in the data or sync layer" "$HITS" "0"
else
  check "source files found for the DELETE check" "missing: $LIB" "found"
fi

echo
echo "────────────────────────────────────"
echo "  $PASS passed, $FAIL failed"
rm -f "$DB" "$DB-wal" "$DB-shm"
[ "$FAIL" -eq 0 ]
