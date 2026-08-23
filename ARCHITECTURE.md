# Proposed Architecture

**Status:** proposal · **Date:** 2026-08-09 · **Companion to:** `REVIEW.md`

`REVIEW.md` describes what's wrong today. This describes where the backend
should go, and — as importantly — what it should *not* do yet.

The app currently has no backend at all. Everything is local: SQLite on the
device, no accounts, no server. That's a genuinely good starting point, and most
of what follows is about *not* giving it up faster than necessary. Each stage is
gated on a real need rather than built up front.

---

## Staging

| Stage | What | Trigger |
|---|---|---|
| **0** | Spend cap + key rotation | **Today.** Nothing to build. |
| **1** | Worker proxy + AI Gateway | Before any public release. Unblocks finding #1. |
| **2** | Accounts, cloud storage, sync | When multi-device or cloud backup is actually wanted. |
| **3** | Push, observability, image storage | When there's something to push, someone to page, or images to store. |

Only stage 0 has a deadline. Stage 1 blocks release. Stages 2 and 3 wait for a
reason to exist — each one adds failure modes the current offline-only app
simply doesn't have.

---

## Stage 0 — today, before anything is built

1. **Set a spend limit on the Anthropic workspace.** Two minutes in the console.
   This is the only hard ceiling that exists — an alert tells you something went
   wrong, a cap stops it. It is also what makes deferring monitoring (stage 3)
   safe rather than reckless.
2. **Rotate the Anthropic key** if any build containing it has been shared with
   anyone, including via TestFlight.

Neither waits for the proxy. The architectural fix takes an afternoon; the old
key stays live in every build already distributed until it's rotated.

---

## Stage 1 — the proxy

**The problem** (finding #1): `EXPO_PUBLIC_` inlines the Anthropic key into the
JavaScript bundle at build time, so it ships to every install and can be read
out of a distributed build in minutes.

**The fix:** the app stops calling Anthropic. A small server-side endpoint holds
the key and makes the call on the app's behalf.

```
Phone ──(request)──> Worker ──(x-api-key)──> AI Gateway ──> Anthropic
      <──(stops)─────        <───────────────
```

The phone sends `{coordinates, hours, vibe, places}`. The Worker owns the system
prompt, the model choice, and the JSON schema, and returns the parsed stops. The
nearest-neighbour route ordering stays on the device — it's pure maths with no
secret involved.

### Two rules that make or break this

**The caller controls data, never instructions.** A Worker that accepts
`{prompt}` and forwards it verbatim is a free Claude account for anyone who finds
the URL. The system prompt must be a constant in the Worker, unreachable from the
request body. This is the single most common way a proxy like this gets built
wrong.

**Validate inputs or the endpoint stays narrow but becomes expensive.** Check
`vibe` against the four known values, cap the length of the `places` array, and
bound `hours`. Otherwise a caller can't change *what* the endpoint does but can
make each call arbitrarily costly.

### AI Gateway

Cloudflare AI Gateway sits between the Worker and Anthropic and provides caching,
rate limiting, spend caps, and per-request analytics. It's a base-URL change, and
it converts "hope nobody abuses the endpoint" into an actual control. Worth
adding at the same time as the Worker, not later.

### Why Cloudflare rather than AWS

Both hide the key equally well. The difference is everything around it.

| | Cloudflare | AWS |
|---|---|---|
| Compute | Worker | Lambda + API Gateway |
| Secret | Worker Secret | SSM Parameter Store |
| Rate limiting | Dashboard rules | API Gateway / WAF |
| Monthly floor | **$0–5** | **$0** — *unless* it needs a VPC |

The AWS caveat is the whole story. A Lambda that needs both a database in RDS and
outbound internet to reach Anthropic must sit in a VPC, and a Lambda in a VPC has
no internet access by default. Reaching `api.anthropic.com` then requires a NAT
Gateway at roughly **$32/month running 24/7 whether used or not**. There's no VPC
endpoint for Anthropic to avoid it. That cost is entirely absent on Cloudflare.

This is reversible. The app calls a URL either way; swapping it is a one-line
change. Revisit if there's revenue and a concrete reason.

---

## Stage 2 — accounts and sync

Needed only when multi-device access or cloud backup is actually wanted. Until
then the local database is doing its job.

### Storage: D1

**D1** is Cloudflare's SQLite-at-the-edge database. That's a convenient fit — the
app already uses SQLite locally via `expo-sqlite`, so the schema in `lib/db.ts`
transfers with minimal change and the same SQL dialect applies.

For clarity on the neighbouring products, since the names give no help:

| Product | What it is | Use here |
|---|---|---|
| **D1** | SQL database | Accounts, places, lists |
| **KV** | Key-value store | Config, feature flags |
| **Durable Objects** | Single-owner stateful coordination | Per-user sync ordering, if it gets complex |
| **R2** | Object storage (S3 equivalent) | Only if place photos are added |

R2 is not a database and can't be queried — it becomes relevant if and when
users attach images to places, and not before.

### Auth: Sign in with Apple only

No passwords to store, and Apple requires offering Sign in with Apple if any
third-party login is offered — so Apple-only is also the cheapest compliant path.
Verify the identity token server-side in the Worker against Apple's public keys.

**One gotcha that catches everyone:** Apple returns the user's name and email
**only on the very first authorization**. Every subsequent sign-in returns just
the stable user ID. Persist name and email on that first callback or they are
gone permanently — the user would have to remove the app from their Apple ID
settings to trigger it again.

Note this is iOS-only in practice. Android would need a second provider.

### Encryption: at rest is enough

**D1 is encrypted at rest by Cloudflare.** Nothing to configure.

Application-level encryption of coordinates was considered and **rejected**: a
database cannot compare values it can't read, so encrypting `lat`/`lng` breaks
`getPlacesNearCoordinates` entirely and turns every "places near me" into a
full-table fetch-and-decrypt. That doesn't scale, and it moves the plaintext into
Worker memory anyway.

Real protection is **every query scoped to the authenticated user's ID, enforced
server-side.** Row-scoping bugs leak far more data in practice than missing
encryption does. If defence-in-depth is wanted later, encrypt the free-text
`note` field only — it's never queried.

### Sync model: cloud-authoritative

The phone keeps SQLite as a cache. D1 seeds it on login. Writes made offline
queue locally and replay when possible.

This is the simplest model that works, and it's the right trade for a travel app
where the alternative is explaining conflict resolution to users. Two edges that
will bite if not designed for:

**Deletes need tombstones.** A place deleted offline gets seeded straight back by
the next sync unless deletion is recorded as a timestamped marker rather than a
removed row. Purge tombstones server-side after a few weeks.

**"As soon as they get internet" is not an event you can build on.** iOS does not
reliably wake an app on connectivity change. Sync on **app foreground** and on
**retry after a failed write**, with the queue persisted in SQLite so it survives
the app being killed. Same outcome, achievable design.

Also needed: a per-row `updatedAt` and a sync cursor, so a sync isn't a full
re-send every time.

**Plan the first-login migration.** Everything already saved on a device has to
become that user's cloud data without duplicating. This is a one-time path that's
easy to forget until someone loses their places.

### A privacy decision to make here

`notification_log` (`lib/db.ts`) stores `placeId` and a timestamp. Locally that's
harmless — it exists only to enforce the 24-hour cooldown, and the cooldown only
needs to work on the device that fired the alert.

**Synced to D1, it becomes a server-side record of where someone was and when.**
Recommendation: keep that table device-local and out of sync scope.

More generally: the app does **not** log location — verified, `userCoords`
(`map.tsx:78`) never reaches a database write. But saved places are still
location data, and the App Privacy questionnaire will need to declare precise
location collection.

---

## Stage 3 — deliberately deferred

**Push notifications — probably never needed.** Proximity alerts are *local*
notifications: the device decides and fires them, with no server involved. That
stays true under real geofencing, where iOS wakes the app on a boundary crossing
and it fires locally. Push is only for server-*initiated* messages, and there
isn't a use for one. If that changes, note APNs requires HTTP/2 with a signed
ES256 JWT — prototype that leg from a Worker before committing, as the HTTP/2
requirement is the part that surprises people.

**Observability (OpenTelemetry → Grafana Cloud) — after there are paying users.**
Workers export traces natively, so this is easy to add later. It's safe to defer
*because* the stage 0 spend cap is a hard ceiling rather than an alert. When it's
added, the four signals worth having are: itinerary endpoint error rate, daily
Anthropic spend against cap, auth failure spikes, and D1 query latency.

**R2** — when place photos exist.

---

## Cost

| | Monthly |
|---|---|
| Workers Paid | $5 |
| D1 | free tier covers 5GB |
| AI Gateway | free |
| Anthropic usage | metered, capped by the stage 0 spend limit |
| Domain | at cost via Cloudflare |

Realistically about $5/month until there are real users, which is the shape this
should have at this stage.

---

## Open questions

1. **Multi-device** — is it wanted, and when? It's the entire trigger for stage 2.
   Without it, the local database is sufficient and simpler.
2. **Android** — Sign in with Apple works but is clunkier off-platform, and would
   need a second provider. Worth knowing before auth is built.
3. **Data ownership** — if a user deletes their account, what happens to their
   saved places? Easier to decide before there are any.
