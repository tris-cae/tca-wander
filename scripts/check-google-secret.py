"""Ask Google whether a client_id + client_secret pair is valid.

Trick: send a deliberately invalid authorization code. Google validates the
CLIENT credentials before it looks at the code, so the error tells us which
part it disliked:

    invalid_client  -> the client_id/secret pair is wrong
    invalid_grant   -> credentials fine, only the (fake) code was rejected

A control run with a knowingly-wrong secret proves the test can actually fail.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

CID = os.environ["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID"]
SEC = os.environ["SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET"]
REDIRECT = "https://sadqtzcszgfbzztdwsco.supabase.co/auth/v1/callback"


def attempt(label, client_secret):
    body = urllib.parse.urlencode({
        "code": "4/0AdeliberatelyInvalidCodeForDiagnosis",
        "client_id": CID,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        urllib.request.urlopen(req, timeout=30)
        print(label + ": unexpectedly succeeded (should not happen)")
        return
    except urllib.error.HTTPError as exc:
        # Python deletes the `as` name when the except block ends, so copy out
        # everything needed before leaving it.
        status = exc.code
        payload = exc.read().decode("utf8", "replace")

    try:
        data = json.loads(payload)
    except ValueError:
        print(label + ": HTTP %s unparseable: %s" % (status, payload[:200]))
        return

    err = data.get("error", "?")
    desc = data.get("error_description", "")
    print("%s: HTTP %s  error=%s  (%s)" % (label, status, err, desc))

    if err == "invalid_grant":
        print("    -> credentials ACCEPTED; only the fake code was refused.")
        print("       This client_id + secret pair is CORRECT.")
    elif err == "invalid_client":
        print("    -> credentials REFUSED.")
        print("       This client_id + secret pair is WRONG.")
    else:
        print("    -> inconclusive; neither invalid_client nor invalid_grant.")

    return err


# The control must fail, otherwise this script cannot detect a bad secret at
# all and a green result would mean nothing.
control = attempt("control, knowingly wrong secret", "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")
print()
actual = attempt("the secret in your .env        ", SEC)
print()

if control != "invalid_client":
    print("INCONCLUSIVE: the control secret was not rejected as expected")
    print("(got '%s'). Google may have changed its responses, so this" % control)
    print("script can no longer prove a bad secret would be caught.")
    raise SystemExit(1)

if actual == "invalid_grant":
    print("PASS: Google accepts this client_id and secret.")
    raise SystemExit(0)

if actual == "invalid_client":
    print("FAIL: Google rejects this client_id + secret pair.")
    print()
    print("Google sign-in cannot work until this is fixed. In the app the")
    print("symptom is 'Unable to exchange external code' AFTER the account")
    print("picker, because the secret is only used at the final step.")
    print()
    print("To fix:")
    print("  1. console.cloud.google.com/apis/credentials")
    print("  2. Open the OAuth 2.0 Client ID ending", CID.split("-")[1][:12] + "...")
    print("  3. Under 'Client secrets', add a secret (or copy the existing one)")
    print("  4. Put it in .env as SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET")
    print("  5. Re-run scripts/push-supabase-config.sh")
    raise SystemExit(1)

print("INCONCLUSIVE: unexpected response '%s'." % actual)
raise SystemExit(1)
