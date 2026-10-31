#!/bin/bash
# Outbox trigger test for Notice Explore.
#
# The outbox is the part of sync that cannot be checked by reading the code:
# it is SQLite trigger behaviour, and the failure modes are silent. A trigger
# that does not fire means a place is saved, looks fine, and never reaches the
# server. A trigger that fires when it should not means the app pulls a change
# from the server, queues it straight back for upload, pulls it again, forever.
#
# So this builds a real database with the exact statements from lib/db.ts and
# asserts the behaviour, rather than trusting that the SQL reads correctly.
set -u

DB=/tmp/notice-outbox-test.db
rm -f "$DB"
PASS=0; FAIL=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1))
  else echo "  FAIL  $1 — got [$2] expected [$3]"; FAIL=$((FAIL+1)); fi
}

echo "=== 1. Create the schema (exact statements from lib/db.ts) ==="
sqlite3 "$DB" <<'SQL'
PRAGMA journal_mode = WAL;
CREATE TABLE places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, address TEXT, note TEXT,
  sourceUrl TEXT, sourceType TEXT NOT NULL, savedAt TEXT NOT NULL,
  updatedAt TEXT, deletedAt TEXT, placeId TEXT,
  visited INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS sync_outbox (
  entity TEXT NOT NULL, entityId TEXT NOT NULL, queuedAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT,
  PRIMARY KEY (entity, entityId)
);

CREATE TRIGGER IF NOT EXISTS places_outbox_insert
AFTER INSERT ON places
WHEN (SELECT value FROM sync_meta WHERE key = 'applyingRemote') IS NULL
BEGIN
  INSERT INTO sync_outbox (entity, entityId, queuedAt)
  VALUES ('place', NEW.id, NEW.updatedAt)
  ON CONFLICT(entity, entityId)
  DO UPDATE SET queuedAt = excluded.queuedAt, attempts = 0, lastError = NULL;
END;

CREATE TRIGGER IF NOT EXISTS places_outbox_update
AFTER UPDATE ON places
WHEN (SELECT value FROM sync_meta WHERE key = 'applyingRemote') IS NULL
BEGIN
  INSERT INTO sync_outbox (entity, entityId, queuedAt)
  VALUES ('place', NEW.id, NEW.updatedAt)
  ON CONFLICT(entity, entityId)
  DO UPDATE SET queuedAt = excluded.queuedAt, attempts = 0, lastError = NULL;
END;
SQL

echo
echo "=== 2. Saving a place queues it ==="
sqlite3 "$DB" "INSERT INTO places (id,name,category,lat,lng,sourceType,savedAt,updatedAt)
               VALUES ('p1','Café Central','Café',40.42,-3.70,'manual','2026-10-01T10:00:00.000Z','2026-10-01T10:00:00.000Z');"
check "one entry queued" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox;")" "1"
check "queued with the place's own timestamp" \
  "$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='p1';")" \
  "2026-10-01T10:00:00.000Z"

echo
echo "=== 3. Editing the same place ten times still queues it once ==="
for i in $(seq 1 10); do
  sqlite3 "$DB" "UPDATE places SET note='edit $i', updatedAt='2026-10-01T11:0$i:00.000Z' WHERE id='p1';"
done
check "still a single queue entry" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox;")" "1"
check "queued at the LATEST edit, not the first" \
  "$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='p1';")" \
  "2026-10-01T11:010:00.000Z"

echo
echo "=== 4. Deleting queues it too (soft delete is an UPDATE) ==="
sqlite3 "$DB" "UPDATE places SET deletedAt='2026-10-02T09:00:00.000Z', updatedAt='2026-10-02T09:00:00.000Z' WHERE id='p1';"
check "deletion is queued, not dropped" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox WHERE entityId='p1';")" "1"
check "queued at the deletion time" \
  "$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='p1';")" \
  "2026-10-02T09:00:00.000Z"

echo
echo "=== 5. Applying a change FROM the server does not queue it back ==="
# This is the loop guard. Without it: pull writes a row, the trigger queues it,
# the next push sends it back, the next pull returns it again — forever.
sqlite3 "$DB" "DELETE FROM sync_outbox;"
sqlite3 "$DB" <<'SQL'
BEGIN;
INSERT INTO sync_meta (key,value) VALUES ('applyingRemote','1')
  ON CONFLICT(key) DO UPDATE SET value='1';
INSERT INTO places (id,name,category,lat,lng,sourceType,savedAt,updatedAt)
  VALUES ('p2','Sobrino de Botín','Restaurant',40.41,-3.70,'manual','2026-10-03T10:00:00.000Z','2026-10-03T10:00:00.000Z');
UPDATE places SET note='from the iPad', updatedAt='2026-10-03T10:05:00.000Z' WHERE id='p2';
DELETE FROM sync_meta WHERE key='applyingRemote';
COMMIT;
SQL
check "remote insert was NOT queued" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox WHERE entityId='p2';")" "0"
check "the place itself was still written" \
  "$(sqlite3 "$DB" "SELECT name FROM places WHERE id='p2';")" "Sobrino de Botín"
check "the flag was cleared again" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_meta WHERE key='applyingRemote';")" "0"

echo
echo "=== 6. Local edits resume queueing once the flag is clear ==="
sqlite3 "$DB" "UPDATE places SET note='my own edit', updatedAt='2026-10-04T08:00:00.000Z' WHERE id='p2';"
check "local edit after a pull is queued" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox WHERE entityId='p2';")" "1"

echo
echo "=== 7. A concurrent edit is not lost when the upload clears the queue ==="
# clearOutboxEntries() deletes only if queuedAt still matches what was read.
# An edit made while the upload was in flight bumps queuedAt, so the delete
# misses and the newer edit survives to be sent next time.
sqlite3 "$DB" "DELETE FROM sync_outbox;"
sqlite3 "$DB" "UPDATE places SET note='first', updatedAt='2026-10-05T10:00:00.000Z' WHERE id='p2';"
READ_AT=$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='p2';")
# ... upload starts, and the user edits again before it finishes ...
sqlite3 "$DB" "UPDATE places SET note='second', updatedAt='2026-10-05T10:00:30.000Z' WHERE id='p2';"
# ... upload finishes and tries to clear what it read
sqlite3 "$DB" "DELETE FROM sync_outbox WHERE entity='place' AND entityId='p2' AND queuedAt='$READ_AT';"
check "the newer edit is still queued" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox WHERE entityId='p2';")" "1"
check "and it is the newer one" \
  "$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='p2';")" \
  "2026-10-05T10:00:30.000Z"

echo
echo "=== 8. Seeding pre-account places keeps their real timestamps ==="
# queueAllPlacesForSync() must not bump updatedAt. If it did, every old place
# would look edited-today, and under last-write-wins a fresh reinstall could
# overwrite good server data with a thinner local copy.
sqlite3 "$DB" "DELETE FROM sync_outbox;"
sqlite3 "$DB" "INSERT INTO sync_outbox (entity,entityId,queuedAt)
               SELECT 'place', id, updatedAt FROM places WHERE true
               ON CONFLICT(entity,entityId) DO NOTHING;"
check "every place queued" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM sync_outbox;")" \
  "$(sqlite3 "$DB" "SELECT COUNT(*) FROM places;")"
check "p1 kept its original edit time" \
  "$(sqlite3 "$DB" "SELECT queuedAt FROM sync_outbox WHERE entityId='p1';")" \
  "$(sqlite3 "$DB" "SELECT updatedAt FROM places WHERE id='p1';")"

echo
echo "=== Results ==="
echo "  $PASS passed, $FAIL failed"
rm -f "$DB" "$DB-wal" "$DB-shm"
[ "$FAIL" -eq 0 ]
