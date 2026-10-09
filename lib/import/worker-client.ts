// ─── Talking to the Cloudflare Worker ─────────────────────────────────────────
//
// Two jobs run on the Worker rather than in the app, because both need API keys
// that must never ship inside a binary anyone can unzip:
//
//   searchPlaces()      Google Places text search
//   readScreenshots()   Anthropic reads place names out of images
//
// The app authenticates with a shared token plus a per-install device id. Be
// clear-eyed about what that buys: the token is in the app bundle, so a
// determined person can extract it. It stops casual use of the endpoint by
// anyone who merely finds the URL; the Worker's per-device daily cap is what
// actually limits the damage. See the Worker source for the full picture.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import type { Coords, PlaceCandidate } from './types';

const WORKER_URL = process.env.EXPO_PUBLIC_ITINERARY_WORKER_URL ?? '';
const APP_TOKEN  = process.env.EXPO_PUBLIC_WORKER_APP_TOKEN ?? '';

const DEVICE_ID_KEY = '@import/deviceId';

/** Longest we wait on one search before giving up on that line. */
const SEARCH_TIMEOUT_MS = 15000;
/** Reading images takes longer than a text search. */
const VISION_TIMEOUT_MS = 60000;

/** Raised for anything the caller should show the user. */
export class WorkerError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'rate-limited' | 'server' | 'config') {
    super(message);
    this.name = 'WorkerError';
  }
}

/**
 * A stable random id for this install, so the Worker can rate-limit per device
 * without us sending anything that identifies the person. Generated on first
 * use and kept in local storage; a reinstall produces a new one.
 */
async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage unavailable — a per-session id still lets the Worker group
    // requests, it just resets more often.
    return Crypto.randomUUID();
  }
}

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!WORKER_URL) {
    throw new WorkerError('Import is not configured on this build.', 'config');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${WORKER_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${APP_TOKEN}`,
        'X-Device-Id':   await getDeviceId(),
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new WorkerError(
        data.error ?? 'That is as many lookups as this device can do today.',
        'rate-limited'
      );
    }

    if (!response.ok) {
      throw new WorkerError(`The lookup service returned ${response.status}.`, 'server');
    }

    return await response.json() as T;
  } catch (err) {
    if (err instanceof WorkerError) throw err;
    if ((err as any)?.name === 'AbortError') {
      throw new WorkerError('That took too long. Nothing was saved.', 'offline');
    }
    throw new WorkerError('No connection to the lookup service.', 'offline');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One Places text search, biased toward the chosen city.
 *
 * Returns every match Google gave back, best-first in Google's own order — the
 * re-ranking for the user's chosen city happens in match-picking.ts.
 */
export async function searchPlaces(
  query: string,
  cityCentre: Coords | null
): Promise<PlaceCandidate[]> {
  const data = await post<{ candidates?: PlaceCandidate[] }>(
    '/places/search',
    { query, bias: cityCentre ? { ...cityCentre, radiusM: 50000 } : null },
    SEARCH_TIMEOUT_MS
  );
  return data.candidates ?? [];
}

export interface ReadName {
  name: string;
  city: string | null;
  /** True when the model was unsure it read this correctly. */
  uncertain: boolean;
}

/**
 * Sends base64 images to the Worker, which asks Anthropic to read the place
 * names out of them. The app never holds the Anthropic key.
 */
export async function readScreenshots(base64Images: string[]): Promise<ReadName[]> {
  const data = await post<{ names?: ReadName[] }>(
    '/screenshots/read',
    { images: base64Images },
    VISION_TIMEOUT_MS
  );
  return data.names ?? [];
}
