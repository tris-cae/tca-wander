"""Run SQL against the live Supabase project and print the result as a table.

    SQL="select count(*) from places" python3 -I scripts/sql.py
    python3 -I scripts/sql.py "select count(*) from places"

Reads SUPABASE_ACCESS_TOKEN from the environment (it lives in .env, which is
gitignored). Load it first:

    set -a && . ./.env && set +a

This talks to the Management API rather than connecting to Postgres directly,
so it needs no database password and no keychain — the same reason
scripts/push-supabase-config.sh uses a token.

IT RUNS AS AN ADMIN AND IGNORES ROW LEVEL SECURITY. That is useful for
inspecting schema, but it means a plain SELECT here does NOT prove the app can
read the same rows. To check what a signed-in user can actually see or write,
put the query in a transaction that adopts their identity, and roll it back:

    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
    ...the statements the app would run...
    rollback;

That is how the 2026-11-15 sync failure was reproduced: the app's upload was
rejected but the reason was only visible on the device, and running the same
insert under the user's own identity surfaced it immediately.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = "sadqtzcszgfbzztdwsco"
MAX_COL = 60

query = os.environ.get("SQL") or (sys.argv[1] if len(sys.argv) > 1 else "")
if not query.strip():
    print(__doc__)
    raise SystemExit(2)

token = os.environ.get("SUPABASE_ACCESS_TOKEN")
if not token:
    print("error: SUPABASE_ACCESS_TOKEN is not set.")
    print("Run:  set -a && . ./.env && set +a")
    raise SystemExit(2)

req = urllib.request.Request(
    "https://api.supabase.com/v1/projects/%s/database/query" % REF,
    data=json.dumps({"query": query}).encode(),
    headers={"Authorization": "Bearer " + token,
             "Content-Type": "application/json"},
    method="POST",
)
try:
    rows = json.load(urllib.request.urlopen(req, timeout=90))
except urllib.error.HTTPError as exc:
    print("HTTP %s" % exc.code)
    print(exc.read().decode("utf8", "replace")[:2000])
    raise SystemExit(1)

if not isinstance(rows, list):
    print(json.dumps(rows, indent=2)[:4000])
    raise SystemExit(0)

if not rows:
    print("(no rows)")
    raise SystemExit(0)

cols = list(rows[0].keys())
widths = {}
for c in cols:
    longest = max([len(c)] + [len(str(r.get(c))) for r in rows])
    widths[c] = min(longest, MAX_COL)

print(" | ".join(c.ljust(widths[c]) for c in cols))
print("-+-".join("-" * widths[c] for c in cols))
for r in rows:
    print(" | ".join(str(r.get(c))[:MAX_COL].ljust(widths[c]) for c in cols))
print()
print("%d row(s)" % len(rows))
