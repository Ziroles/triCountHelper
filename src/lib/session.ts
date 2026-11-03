/**
 * Staying signed in.
 *
 * The device token never expires on the server: a session is lost when the
 * browser clears the app's storage (Safari after 7 days without a visit, a
 * full disk, "clear site data", a private window). The app then enrols again
 * as a new, anonymous device. Two defences:
 *
 *  - ask the browser to keep our storage (`navigator.storage.persist()`);
 *  - remember the account's address apart from IndexedDB, so a lost session
 *    is noticed and the user asked to sign in again, rather than silently
 *    carrying on without their groups.
 *
 * The address is not a secret; the password and the KEK never come here.
 */

import { logger } from './log';

const log = logger('session');

const EMAIL_KEY = 'splitticket:accountEmail';

export function knownAccountEmail(): string | null {
  try {
    return window.localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function rememberAccountEmail(email: string | null): void {
  try {
    if (email === null) window.localStorage.removeItem(EMAIL_KEY);
    else window.localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // No storage: the reconnection prompt is a convenience, not a guarantee.
  }
}

let persistence: Promise<boolean | null> | null = null;

/**
 * Ask once for persistent storage. Null when the browser has no such API; a
 * refusal changes nothing else — the app works the same, only less durably.
 */
export function requestPersistentStorage(): Promise<boolean | null> {
  if (persistence) return persistence;
  persistence = (async () => {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (typeof storage?.persist !== 'function') {
      log.info('persistent storage: not supported');
      return null;
    }
    try {
      const already = typeof storage.persisted === 'function' ? await storage.persisted() : false;
      const granted = already || (await storage.persist());
      log.info('persistent storage', { granted, already });
      return granted;
    } catch (error) {
      log.warn('persistent storage request failed', error);
      return null;
    }
  })();
  return persistence;
}

/** Tests start from a fresh browser. */
export function resetSessionForTests(): void {
  persistence = null;
}
