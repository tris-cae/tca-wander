#!/usr/bin/env bash
# ─── Send supabase/config.toml to the live project ────────────────────────────
#
# config.toml is the source of truth for how sign-in behaves: which providers
# are on, which redirect URLs are allowed, how long codes last. Editing it does
# nothing on its own — this script is what makes the live server match the file.
#
# ── Why this script exists rather than just typing the command ──
#
# Two things went wrong the first time and both are handled here.
#
#   1. THE KEYCHAIN. `supabase login` stores its credentials in the macOS
#      keychain, and reading them back pops up a dialog asking for your *Mac
#      login password* — the one that unlocks the laptop. The dialog says
#      "Supabase" because that is the name of the saved item, not because it
#      wants a Supabase password, which is a genuinely confusing thing to be
#      shown mid-command. Worse, when run from a script the dialog can appear
#      behind other windows and the command just appears to hang.
#
#      Setting SUPABASE_ACCESS_TOKEN skips the keychain completely. Generate one
#      at https://supabase.com/dashboard/account/tokens and put it in .env as
#      SUPABASE_ACCESS_TOKEN=sbp_...  (.env is gitignored; it must stay that
#      way, because this token can change anything in the project.)
#
#   2. SILENT SKIPS. `config push` does NOT fail when it declines to send a
#      secret. It prints a JSON summary in which that field is listed under
#      "gated" or "not_set", and exits 0. On 2026-10-29 the Google client secret
#      was skipped exactly this way; the push looked successful, and sign-in was
#      broken in TestFlight for two weeks because Supabase could not prove its
#      identity to Google. The error users saw was "Unable to exchange external
#      code", which says nothing about a missing secret.
#
#      So this script reads that summary and fails loudly if a secret we care
#      about did not actually land.
#
# Note the version pin below. Plain `npx supabase` now resolves to 3.x, which
# behaves differently and does not see the login this project was set up with.

set -euo pipefail

CLI_VERSION="2.121.0"

# Resolve paths from this file, not the current directory, so the script is
# correct no matter where it is run from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Secrets that must be present on the server for sign-in to work. If one of
# these is skipped, the push has not done its job.
REQUIRED_SECRETS="auth.external.google.secret"

if [ ! -f .env ]; then
  echo "error: no .env file at $ROOT/.env" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  cat >&2 <<'MSG'
error: SUPABASE_ACCESS_TOKEN is not set in .env

Without it the CLI falls back to the macOS keychain, which opens a password
dialog and can hang indefinitely. To fix:

  1. Go to https://supabase.com/dashboard/account/tokens
  2. Generate a new token
  3. Add this line to .env (gitignored):

       SUPABASE_ACCESS_TOKEN=sbp_your_token_here

MSG
  exit 1
fi

# These are read by the CLI to fill the env(...) references in config.toml.
# Checked here rather than letting the push quietly send an empty string.
for var in SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "error: $var is empty or missing in .env" >&2
    echo "       config.toml refers to it with env($var), so the push would" >&2
    echo "       send a blank value and quietly break Google sign-in." >&2
    exit 1
  fi
done

echo "Pushing supabase/config.toml using CLI $CLI_VERSION"
echo

# Capture the output so the summary can be inspected, while still showing it.
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

if ! npx --yes "supabase@$CLI_VERSION" config push --yes 2>&1 | tee "$OUT"; then
  echo >&2
  echo "error: config push failed outright — see the output above." >&2
  exit 1
fi

echo
echo "─── Checking the secrets actually landed ───"

# The CLI prints a JSON object describing what it did with each secret field.
# Anything other than "sent" or "unchanged" means the server was not updated.
python3 - "$OUT" "$REQUIRED_SECRETS" <<'PY'
import json, re, sys

path, required = sys.argv[1], sys.argv[2].split()
text = open(path, encoding="utf8", errors="replace").read()

# Find the JSON object carrying a "secrets" key, wherever it sits in the output.
status = {}
found_summary = False
for match in re.finditer(r'\{.*?"secrets".*?\}\s*$', text, re.S | re.M):
    try:
        blob = json.loads(match.group(0))
    except ValueError:
        continue
    secrets = blob.get("secrets")
    if not isinstance(secrets, dict):
        continue
    found_summary = True
    for state, fields in secrets.items():
        for field in fields or []:
            name = ".".join(field) if isinstance(field, list) else str(field)
            status[name] = state

if not found_summary:
    print("warning: could not find the secrets summary in the push output.")
    print("         The push may have succeeded, but this script cannot")
    print("         confirm the client secret reached the server. Verify by")
    print("         signing in with Google on a device before trusting it.")
    sys.exit(1)

ok_states = {"sent", "unchanged"}
failed = []

for name in required:
    state = status.get(name, "not mentioned")
    mark = "ok  " if state in ok_states else "FAIL"
    print(f"  [{mark}] {name}: {state}")
    if state not in ok_states:
        failed.append((name, state))

# Report anything else the push skipped, as information rather than failure.
others = {n: s for n, s in status.items()
          if n not in required and s not in ok_states}
if others:
    print()
    print("  Other fields the push did not send (may be intentional):")
    for name, state in sorted(others.items()):
        print(f"    - {name}: {state}")

if failed:
    print()
    print("FAILED: a secret sign-in depends on did not reach the server.")
    for name, state in failed:
        print(f"  {name} reported '{state}' rather than 'sent'.")
    print()
    print("'gated' usually means the CLI declined to send it — check that the")
    print("field is uncommented in supabase/config.toml and that the env(...)")
    print("name in config.toml matches the variable name in .env exactly.")
    print()
    print("Until this is fixed, Google sign-in will fail with")
    print("\"Unable to exchange external code\" after the account picker.")
    sys.exit(1)

print()
print("All required secrets are on the server.")
PY

echo
echo "─── Checking Google actually accepts the credentials ───"
echo
# The check above only proves the secret was SENT. On 2026-11-12 it reported
# "unchanged" and was perfectly correct to: the same WRONG secret was sitting
# in .env and on the server, so there was no difference to push. Sign-in was
# still broken. Asking Google directly is the only check that means anything.
if ! python3 -I "$ROOT/scripts/check-google-secret.py"; then
  echo >&2
  echo "error: could not verify the Google credentials." >&2
  exit 1
fi

echo
echo "Done."
