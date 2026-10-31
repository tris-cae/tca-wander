// ─── Accounts ─────────────────────────────────────────────────────────────────
//
// Three ways in — Apple, Google, and an emailed code — all of which end at the
// same place: a Supabase session held by the provider below. Every screen reads
// it through useAuth().
//
// Why three. Apple is required: Apple's own guideline 4.8 says an app offering
// any third-party sign-in must also offer Sign in with Apple. Google is here
// because Tristan asked for it and most people saving travel places already
// have a Google account open. Email exists so that nobody is forced into either.
//
// The cost of offering three is the duplicate-account trap: sign in with Google
// on Monday and Apple on Tuesday and you get two accounts with two separate sets
// of places, having done nothing wrong. Supabase does not merge them. The
// mitigation is to remember which one was used last and put it first on the
// sign-in screen — see rememberProvider() at the bottom, and note honestly what
// it does not cover.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User } from '@supabase/supabase-js';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type Provider = 'apple' | 'google' | 'email';

/**
 * Email sign-in is written and working, but switched off.
 *
 * It depends on an emailed six-digit code, and Supabase will not send one until
 * the project has its own email service: custom email templates are blocked on
 * the free tier, and the built-in sender is capped at two emails per hour for
 * the entire project — fine for one tester, useless for real users.
 *
 * Nothing here is a workaround waiting to be undone. Flip this to true once
 * [auth.email.smtp] is filled in and the two template blocks in
 * supabase/config.toml are uncommented, and the button comes back.
 *
 * Apple plus Google is fully App Store compliant on its own: Apple's rule is
 * that offering a third-party sign-in obliges you to offer Apple too, which
 * this does.
 */
export const EMAIL_SIGN_IN_ENABLED = false;

/** Where the browser sends Google back to. Matches app.json's `scheme`. */
const REDIRECT_PATH = 'auth-callback';

/** Which provider this device used last, so the sign-in screen can lead with it. */
const K_LAST_PROVIDER = '@auth/lastProvider';

// ─── Context ──────────────────────────────────────────────────────────────────

interface AuthValue {
  /** Null when signed out. */
  session: Session | null;
  user: User | null;
  /** True until the stored session has been read from disk. */
  loading: boolean;

  signInWithApple(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  /** Step one of email sign-in: send the code. */
  sendEmailCode(email: string): Promise<void>;
  /** Step two: exchange the code for a session. */
  verifyEmailCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** Irreversible. Removes the account and everything hanging off it. */
  deleteAccount(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() used outside <AuthProvider>');
  return value;
}

/** The last provider used on this device, or null. For ordering the buttons. */
export async function getLastProvider(): Promise<Provider | null> {
  const raw = await AsyncStorage.getItem(K_LAST_PROVIDER);
  return raw === 'apple' || raw === 'google' || raw === 'email' ? raw : null;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Reading the stored session touches disk, so the app shows a loading state
    // until it resolves. Skipping this makes a signed-in user flash the
    // sign-in screen on every cold start.
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch((err) => {
        console.error('[auth] could not read the stored session:', err);
      })
      .finally(() => setLoading(false));

    // Fires on sign-in, sign-out, and every token refresh. This is the single
    // place session state changes; nothing else calls setSession.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // ── Apple ───────────────────────────────────────────────────────────────────
  //
  // Native sheet, no browser. Apple returns a signed identity token which
  // Supabase verifies itself, so there is no secret involved and nothing to
  // intercept.

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      throw new Error('Sign in with Apple is only available on iPhone and iPad.');
    }

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      throw new Error('Apple did not return a sign-in token. Please try again.');
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) throw friendlier(error);

    // Apple sends the person's name ONLY on the very first sign-in, and never
    // again — not even after deleting and reinstalling the app. If it is not
    // captured here it is gone for good, so it is written immediately rather
    // than as part of a later profile step.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (name && data.user) {
      await supabase
        .from('profiles')
        .update({ display_name: name })
        .eq('id', data.user.id);
    }

    await rememberProvider('apple', data.user?.id);
  }, []);

  // ── Google ──────────────────────────────────────────────────────────────────
  //
  // Opens Google's own sign-in page in a system browser sheet. Deliberately not
  // the native Google SDK: that package requires Expo 57 and this app is on 55,
  // and adding a native module risks the background location task's build. The
  // sheet shares Safari's cookies, so anyone already signed in to Google taps
  // once and is done.

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = Linking.createURL(REDIRECT_PATH);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // We open the browser ourselves below so the sheet is tied to the app
        // and closes on its own when Google redirects back.
        skipBrowserRedirect: true,
      },
    });
    if (error) throw friendlier(error);
    if (!data?.url) throw new Error('Could not reach Google. Please try again.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    // The user swiped the sheet away or tapped Cancel. Not an error — just stop.
    if (result.type !== 'success') return;

    const code = paramFromUrl(result.url, 'code');
    if (!code) {
      // Google can redirect back with an error instead of a code, e.g. if the
      // account is blocked or consent was refused.
      const described = paramFromUrl(result.url, 'error_description');
      throw new Error(described ?? 'Google sign-in did not complete. Please try again.');
    }

    // PKCE: the code is exchanged for a session using a verifier that never
    // left this device, which is what stops a stolen code from being useful.
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error) throw friendlier(exchanged.error);

    await rememberProvider('google', exchanged.data.user?.id);
  }, []);

  // ── Email ───────────────────────────────────────────────────────────────────
  //
  // A six-digit code rather than a magic link. A link has to leave the app,
  // open a browser and come back, and on iOS that round trip breaks whenever
  // the link opens in a different browser than the one that started it. Typing
  // six digits always works.

  const sendEmailCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    if (error) throw friendlier(error);
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    if (error) throw friendlier(error);

    await rememberProvider('email', data.user?.id);
  }, []);

  // ── Leaving ─────────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw friendlier(error);
  }, []);

  const deleteAccount = useCallback(async () => {
    // Runs delete_account() on the server. Everything cascades from the login
    // row: places, lists, shares, invites, blocks. Reports survive with the
    // reporter detached, so a complaint cannot be erased by its subject.
    const { error } = await supabase.rpc('delete_account');
    if (error) throw friendlier(error);

    // The session is now pointing at an account that no longer exists.
    await supabase.auth.signOut();
    await AsyncStorage.removeItem(K_LAST_PROVIDER);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    signInWithApple,
    signInWithGoogle,
    sendEmailCode,
    verifyEmailCode,
    signOut,
    deleteAccount,
  }), [
    session, loading, signInWithApple, signInWithGoogle,
    sendEmailCode, verifyEmailCode, signOut, deleteAccount,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Note which provider was used, in two places and for two different reasons.
 *
 * On the device: so the sign-in screen can put that button first next time.
 * This is the one that actually prevents duplicate accounts, and it only works
 * while the app stays installed — deleting the app clears it, and the person is
 * then free to pick the other button and start a second, empty account.
 *
 * On the server: so the same hint survives to a new phone, once signed in. It
 * cannot help the sign-in screen itself, which by definition runs before there
 * is anyone to look up.
 */
async function rememberProvider(provider: Provider, userId?: string) {
  try {
    await AsyncStorage.setItem(K_LAST_PROVIDER, provider);
  } catch {
    // A failed hint is a worse sign-in screen, not a failed sign-in.
  }

  if (!userId) return;
  try {
    await supabase.from('profiles').update({ last_provider: provider }).eq('id', userId);
  } catch (err) {
    console.warn('[auth] could not record the sign-in method:', err);
  }
}

/** Pull one query parameter out of a redirect URL, without needing a URL polyfill. */
function paramFromUrl(url: string, name: string): string | null {
  const match = url.match(new RegExp(`[?&#]${name}=([^&#]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Supabase's messages are written for developers. These are the ones a person
 * can actually hit while signing in; everything else passes through unchanged
 * rather than being flattened into a useless "something went wrong".
 */
function friendlier(error: { message: string }): Error {
  const m = error.message.toLowerCase();

  if (m.includes('token has expired') || m.includes('otp_expired')) {
    return new Error('That code has expired. Send a new one.');
  }
  if (m.includes('invalid') && m.includes('token')) {
    return new Error("That code didn't match. Check it and try again.");
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return new Error('Too many tries just now. Wait a minute and try again.');
  }
  if (m.includes('network') || m.includes('fetch')) {
    return new Error('No connection. Check your internet and try again.');
  }
  return new Error(error.message);
}
