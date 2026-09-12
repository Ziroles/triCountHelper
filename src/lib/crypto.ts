/**
 * Client-side envelope for the user's Gemini key.
 *
 * The server stores that key, and cannot read it. This file is the reason why.
 *
 * One derivation, two branches, from the account password:
 *
 *     master = PBKDF2-SHA256(password, salt, 600 000)
 *        ├─ HKDF(master, "…/auth") → proof, sent instead of the password
 *        └─ HKDF(master, "…/kek")  → the key that opens the blob, and which
 *                                    never leaves this browser
 *
 * The two branches are independent outputs of an HKDF: holding the proof — as
 * the server does, hashed — says nothing about the KEK. That is what lets us
 * send the API something it can authenticate with, while remaining unable to
 * decrypt what it keeps for us.
 *
 * The direct consequence, which the interface has to state plainly: a
 * forgotten password loses the saved Gemini key. Nobody can give it back.
 */

import { logger } from './log';

const log = logger('crypto');

/* Cost of a derivation, in PBKDF2 rounds. High enough to make an offline
   attempt on a stolen blob expensive, low enough to stay unnoticed on a phone
   (~300 ms). Changing it invalidates every existing blob — it is part of the
   format, not a tuning knob. */
const ITERATIONS = 600_000;

const AUTH_INFO = 'splitticket/v1/auth';
const KEK_INFO = 'splitticket/v1/kek';

/** Envelope format marker: the day it changes, old blobs stay readable. */
const VERSION = 'v1';

/* WebCrypto wants a BufferSource, and TypeScript distinguishes a view over a
   possibly-shared buffer from a plain ArrayBuffer. Handing back the buffer
   itself sidesteps the whole question. */
function utf8(value: string): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = new TextEncoder().encode(value);
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Salt for a new account. Public: it only has to be unique, so that the same
 * password on two instances does not produce the same key.
 */
export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export type Derived = {
  /** Sent to the API in place of the password. */
  proof: string;
  /**
   * Unlocks the Gemini key. Deliberately **non-extractable**: it can be used
   * and stored, never read back — not even by our own code, and therefore not
   * by anything that manages to run in this page either.
   */
  kek: CryptoKey;
};

/** password + salt → what to send, and what to keep. */
export async function derive(password: string, salt: string): Promise<Derived> {
  const done = log.time('derivation');

  const passwordKey = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const master = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: utf8(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdf = (info: string) => ({
    name: 'HKDF' as const,
    hash: 'SHA-256' as const,
    salt: utf8(salt),
    info: utf8(info),
  });

  const proofBits = await crypto.subtle.deriveBits(hkdf(AUTH_INFO), hkdfKey, 256);
  const kek = await crypto.subtle.deriveKey(hkdf(KEK_INFO), hkdfKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);

  done('derived');
  return { proof: toBase64(new Uint8Array(proofBits)), kek };
}

/** Gemini key → blob for the server. A fresh iv every time, as AES-GCM demands. */
export async function seal(kek: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, utf8(plaintext));
  return `${VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

/**
 * Blob → Gemini key, or null.
 *
 * Returning null rather than throwing is deliberate: the ordinary reason to
 * fail here is a password changed on another device, which is a state to show,
 * not an incident to report.
 */
export async function open(kek: CryptoKey, blob: string): Promise<string | null> {
  const [version, iv, payload] = blob.split('.');
  if (version !== VERSION || !iv || !payload) {
    log.warn('unknown blob format', { version });
    return null;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) },
      kek,
      fromBase64(payload),
    );
    return new TextDecoder().decode(plain);
  } catch {
    /* AES-GCM authenticates: a wrong key does not give wrong plaintext, it
       fails outright. Which is exactly what we want to hear. */
    log.warn('blob unreadable with this key');
    return null;
  }
}

/** "AIza…7fQ" — enough for its owner to recognise their key, useless to anyone else. */
export function hint(key: string): string {
  const trimmed = key.trim();
  return trimmed.length <= 8 ? '…' : `${trimmed.slice(0, 4)}…${trimmed.slice(-3)}`;
}
