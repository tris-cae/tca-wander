// ─── Sign in ──────────────────────────────────────────────────────────────────
//
// One screen, three steps: pick a method, type an email, type the code. Written
// as a small state machine rather than three routes so that going back a step
// never loses what was already typed.
//
// Every string comes from lib/auth-copy.ts.

import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AUTH_COPY as C, fill } from '../../lib/auth-copy';
import { EMAIL_SIGN_IN_ENABLED, getLastProvider, useAuth, type Provider } from '../../lib/auth';
import { Colors, FontSize, Radius, Spacing, Typography } from '../../lib/theme';

type Step = 'choose' | 'email' | 'code';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { signInWithApple, signInWithGoogle, sendEmailCode, verifyEmailCode, session } = useAuth();

  const [step,    setStep]    = useState<Step>('choose');
  const [email,   setEmail]   = useState('');
  const [code,    setCode]    = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);
  const [last,    setLast]    = useState<Provider | null>(null);
  const [appleOk, setAppleOk] = useState(false);

  // Which button to lead with, and whether Apple's sheet exists on this device
  // (it needs iOS 13+, so an old iPad would otherwise show a dead button).
  useEffect(() => {
    getLastProvider().then(setLast).catch(() => {});
    AppleAuthentication.isAvailableAsync().then(setAppleOk).catch(() => setAppleOk(false));
  }, []);

  // Leave as soon as a session exists, however it arrived.
  useEffect(() => {
    if (session) router.back();
  }, [session]);

  // ── Running a sign-in attempt ───────────────────────────────────────────────
  //
  // One wrapper for all of them: clear the last error, show a spinner, and turn
  // a thrown error into a line of text rather than a red screen.

  const attempt = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      // Dismissing Apple's sheet throws, but the person simply changed their
      // mind. Saying "that didn't work" to someone who tapped Cancel is wrong.
      if (err?.code === 'ERR_REQUEST_CANCELED' || err?.code === 'ERR_CANCELED') return;
      setError(err?.message ?? C.errors.generic);
    } finally {
      setBusy(false);
    }
  }, []);

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSendCode = useCallback(() => {
    if (!emailLooksValid) { setError(C.email.invalid); return; }
    attempt(async () => {
      await sendEmailCode(email);
      setStep('code');
    });
  }, [attempt, email, emailLooksValid, sendEmailCode]);

  const handleResend = useCallback(() => {
    attempt(async () => {
      await sendEmailCode(email);
      setNotice(C.code.resent);
    });
  }, [attempt, email, sendEmailCode]);

  const handleVerify = useCallback(() => {
    attempt(() => verifyEmailCode(email, code));
  }, [attempt, code, email, verifyEmailCode]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 'choose' && (
          <>
            <Text style={styles.title}>{C.signIn.title}</Text>
            <Text style={styles.intro}>{C.signIn.intro}</Text>

            <View style={styles.buttons}>
              {appleOk && (
                <View>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={Radius.md}
                    style={styles.appleButton}
                    onPress={() => attempt(signInWithApple)}
                  />
                  {last === 'apple' && <Text style={styles.lastUsed}>{C.signIn.lastUsedBadge}</Text>}
                </View>
              )}

              <View>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => attempt(signInWithGoogle)}
                  activeOpacity={0.8}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>{C.signIn.googleButton}</Text>
                </TouchableOpacity>
                {last === 'google' && <Text style={styles.lastUsed}>{C.signIn.lastUsedBadge}</Text>}
              </View>

              {/* Off until the project has its own email service — see
                  EMAIL_SIGN_IN_ENABLED in lib/auth.tsx for why. */}
              {EMAIL_SIGN_IN_ENABLED && (
                <View>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => { setError(null); setStep('email'); }}
                    activeOpacity={0.8}
                    disabled={busy}
                  >
                    <Text style={styles.secondaryButtonText}>{C.signIn.emailButton}</Text>
                  </TouchableOpacity>
                  {last === 'email' && <Text style={styles.lastUsed}>{C.signIn.lastUsedBadge}</Text>}
                </View>
              )}
            </View>

            <TouchableOpacity onPress={() => router.back()} hitSlop={12} disabled={busy}>
              <Text style={styles.skip}>{C.signIn.skip}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'email' && (
          <>
            <Text style={styles.title}>{C.email.title}</Text>
            <Text style={styles.intro}>{C.email.intro}</Text>

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              placeholder={C.email.placeholder}
              placeholderTextColor={Colors.disabled}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              autoFocus
              editable={!busy}
              onSubmitEditing={handleSendCode}
              returnKeyType="go"
            />

            <TouchableOpacity
              style={[styles.primaryButton, (!emailLooksValid || busy) && styles.primaryButtonOff]}
              onPress={handleSendCode}
              activeOpacity={0.8}
              disabled={!emailLooksValid || busy}
            >
              {busy
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.primaryButtonText}>{C.email.sendButton}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('choose')} hitSlop={12} disabled={busy}>
              <Text style={styles.skip}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'code' && (
          <>
            <Text style={styles.title}>{C.code.title}</Text>
            <Text style={styles.intro}>{fill(C.code.intro, { email: email.trim() })}</Text>

            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(t) => { setCode(t.replace(/\D/g, '')); setError(null); }}
              placeholder={C.code.placeholder}
              placeholderTextColor={Colors.disabled}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              editable={!busy}
            />

            <TouchableOpacity
              style={[styles.primaryButton, (code.length < 6 || busy) && styles.primaryButtonOff]}
              onPress={handleVerify}
              activeOpacity={0.8}
              disabled={code.length < 6 || busy}
            >
              {busy
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.primaryButtonText}>{C.code.verifyButton}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleResend} hitSlop={12} disabled={busy}>
              <Text style={styles.skip}>{C.code.resend}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setCode(''); setNotice(null); setStep('email'); }}
              hitSlop={12}
              disabled={busy}
            >
              <Text style={styles.skip}>{C.code.wrongEmail}</Text>
            </TouchableOpacity>
          </>
        )}

        {notice && <Text style={styles.notice}>{notice}</Text>}
        {error  && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.legal}>{C.signIn.legal}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  root: {
    flex: 1,
    backgroundColor: Colors.mist,
  },

  content: {
    paddingHorizontal: Spacing.xl,
    flexGrow: 1,
    justifyContent: 'center',
  },

  title: {
    fontFamily:   Typography.displayFont,
    fontSize:     FontSize.screenTitle,
    color:        Colors.ink,
    marginBottom: Spacing.sm,
  },

  intro: {
    fontFamily:   Typography.bodyFont,
    fontSize:     FontSize.body,
    color:        Colors.sage,
    lineHeight:   22,
    marginBottom: Spacing.xl,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────

  buttons: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },

  // Apple's own button component — its height must be set by us.
  appleButton: {
    height: 50,
    width: '100%',
  },

  secondaryButton: {
    height:          50,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.sage,
    backgroundColor: Colors.white,
    alignItems:      'center',
    justifyContent:  'center',
  },

  secondaryButtonText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.ink,
  },

  primaryButton: {
    height:          50,
    borderRadius:    Radius.md,
    backgroundColor: Colors.forest,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.lg,
    marginBottom:    Spacing.md,
  },

  primaryButtonOff: {
    backgroundColor: Colors.disabled,
  },

  primaryButtonText: {
    fontFamily: Typography.bodyFontMedium,
    fontSize:   FontSize.body,
    color:      Colors.white,
  },

  lastUsed: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    textAlign:  'center',
    marginTop:  Spacing.xs,
  },

  skip: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.body,
    color:      Colors.sage,
    textAlign:  'center',
    paddingVertical: Spacing.sm,
  },

  // ── Input ──────────────────────────────────────────────────────────────────

  input: {
    height:            50,
    borderRadius:      Radius.md,
    borderWidth:       0.5,
    borderColor:       Colors.sage,
    backgroundColor:   Colors.white,
    paddingHorizontal: Spacing.lg,
    fontFamily:        Typography.bodyFont,
    fontSize:          FontSize.body,
    color:             Colors.ink,
  },

  codeInput: {
    textAlign:     'center',
    fontSize:      24,
    letterSpacing: 8,
  },

  // ── Messages ───────────────────────────────────────────────────────────────

  notice: {
    fontFamily: Typography.bodyFont,
    fontSize:   FontSize.metadata,
    color:      Colors.sage,
    textAlign:  'center',
    marginTop:  Spacing.sm,
  },

  error: {
    fontFamily:        Typography.bodyFont,
    fontSize:          FontSize.metadata,
    color:             Colors.errorText,
    backgroundColor:   Colors.errorBg,
    borderRadius:      Radius.sm,
    paddingVertical:   Spacing.sm,
    paddingHorizontal: Spacing.md,
    textAlign:         'center',
    marginTop:         Spacing.sm,
    lineHeight:        18,
  },

  legal: {
    fontFamily: Typography.bodyFont,
    fontSize:   10,
    color:      Colors.disabled,
    textAlign:  'center',
    marginTop:  Spacing.xl,
    lineHeight: 15,
  },
});
