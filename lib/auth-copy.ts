// ─── Every word the account screens show the user ─────────────────────────────
//
// Same arrangement as lib/import/copy.ts: all user-facing text in one place,
// so it can be read and edited without going near screen code.
//
// Voice: quiet and plain. No exclamation marks. Say what happens, not how
// pleased we are about it. Prefer a short sentence to a clever one.

export const AUTH_COPY = {

  // ── Sign-in screen ─────────────────────────────────────────────────────────

  signIn: {
    title: 'Keep your places',

    intro:
      'An account backs up everything you save and lets you share a list with ' +
      'someone else. Your places stay on this phone either way.',

    appleButton:  'Continue with Apple',
    googleButton: 'Continue with Google',
    emailButton:  'Continue with email',

    // Sits under whichever button was used last time on this phone
    lastUsedBadge: 'You used this last time',

    // Shown when the person has used the app for a while without an account
    skip: 'Not now',

    // Small print at the bottom
    legal: 'By continuing you agree to how we handle your places.',
  },

  // ── Email step one: the address ────────────────────────────────────────────

  email: {
    title: 'What’s your email?',

    intro: 'We’ll send a six-digit code. No password to remember.',

    placeholder: 'you@example.com',

    sendButton: 'Send the code',

    sending: 'Sending…',

    invalid: 'That doesn’t look like an email address.',
  },

  // ── Email step two: the code ───────────────────────────────────────────────

  code: {
    title: 'Check your email',

    // {email} is replaced with the address they typed
    intro: 'We sent a six-digit code to {email}. It expires in an hour.',

    placeholder: '123456',

    verifyButton: 'Sign in',

    verifying: 'Checking…',

    resend: 'Send another code',

    // Shown after tapping resend, so the tap visibly did something
    resent: 'Sent. Check your email again.',

    wrongEmail: 'Use a different email',
  },

  // ── Account section on the Profile tab ─────────────────────────────────────

  account: {
    sectionLabel: 'Account',

    signedOutTitle: 'No account yet',

    signedOutBody:
      'Your places live only on this phone. An account backs them up and lets ' +
      'you share a list.',

    signedOutButton: 'Create one or sign in',

    // {email} is replaced with the signed-in address
    signedInTitle: 'Signed in as {email}',

    signedInBody: 'Your places are backed up.',

    // ── Sync status line ─────────────────────────────────────────────────────
    // Replaces signedInBody when there is something more specific to say.

    syncing: 'Backing up…',

    // {n} is the number of places waiting. Shown when the phone has changes it
    // has not managed to send — usually no connection.
    syncPending: '{n} waiting to back up',

    syncFailed: 'Could not back up. It will try again.',

    syncNowButton: 'Back up now',

    signOutButton: 'Sign out',

    deleteButton: 'Delete my account',
  },

  // ── Deleting the account ───────────────────────────────────────────────────

  deleteAccount: {
    title: 'Delete your account?',

    body:
      'This removes your account and everything in it from our server — your ' +
      'places, your lists, and anything you’ve shared. It cannot be undone.',

    // The honest part: the phone keeps its own copy
    keepsLocal:
      'The places saved on this phone stay on this phone. Delete the app to ' +
      'remove those too.',

    confirm: 'Delete it',

    cancel: 'Keep my account',

    deleting: 'Deleting…',
  },

  // ── Things that go wrong ───────────────────────────────────────────────────

  errors: {
    // Shown when Apple's sheet is dismissed — gentle, because it is usually
    // deliberate rather than a failure
    cancelled: '',

    generic: 'That didn’t work. Please try again.',
  },
} as const;

/** Fill {placeholders} in the strings above. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);
}
