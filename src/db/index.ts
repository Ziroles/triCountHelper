/**
 * IndexedDB: read cache and device preferences.
 *
 * This module has changed role. It no longer holds the truth — the API does,
 * ever since receipts became shared between the members of a group. What it
 * keeps here is:
 *
 *  - the **device token**, the only genuinely indispensable piece of data;
 *  - a **cache** of the groups, receipts and photos already viewed, so the app
 *    stays readable offline;
 *  - the **display preferences** (theme, tax regime, default tip), which are of
 *    no interest to anyone but this device.
 *
 * Nothing written here is sent back to the server: the cache is disposable, and
 * a failed read is better than an invented write.
 *
 * The new database has a **distinct name** from the old one. Migrating in place
 * would have meant deleting the old stores to recreate the new ones under the
 * same names — and therefore destroying exactly what the import wizard must
 * still be able to read. Two databases coexist for the duration of the import;
 * the old one is deleted once it has succeeded.
 */

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { logger } from '../lib/log';
import {
  DEFAULT_SETTINGS,
  type Group,
  type GroupSummary,
  type Receipt,
  type ReceiptSummary,
  type Settings,
} from '../types';

const log = logger('db');

const DB_NAME = 'splitticket-app';
const DB_VERSION = 1;

const LEGACY_DB_NAME = 'splitticket';

type CacheStore = 'groups' | 'receipts' | 'receiptLists' | 'images';

interface SplitTicketDB extends DBSchema {
  /** Device identity and local preferences. In-line keys. */
  device: { key: string; value: { key: string; value: unknown } };
  groups: { key: string; value: Group };
  receipts: { key: string; value: Receipt };
  receiptLists: { key: string; value: ReceiptSummary[] };
  images: { key: string; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<SplitTicketDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<SplitTicketDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SplitTicketDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('device', { keyPath: 'key' });
        // Out-of-line keys: the stored value is the bare data, with no
        // technical field added just to find it again.
        db.createObjectStore('groups');
        db.createObjectStore('receipts');
        db.createObjectStore('receiptLists');
        db.createObjectStore('images');
      },
    });
  }
  return dbPromise;
}

/** The cache must never fail a screen: a local failure yields `undefined`. */
async function safely<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch (error) {
    /* Swallowing the error is the right behaviour for the screen — it is what
       makes the app usable in private browsing or with a full quota. But
       swallowed *and* silent, a broken database looks like an empty cache, and
       you go hunting for the bug elsewhere for an hour. */
    log.warn('local cache access refused', error);
    return fallback;
  }
}

// ── Identity and preferences ─────────────────────────────────────────────────

async function readDevice<T>(key: string, fallback: T): Promise<T> {
  return safely(async () => {
    const record = await (await getDb()).get('device', key);
    return record === undefined ? fallback : (record.value as T);
  }, fallback);
}

async function writeDevice(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('device', { key, value });
}

export const getDeviceToken = (): Promise<string | null> => readDevice('token', null);
export const setDeviceToken = (token: string): Promise<void> => writeDevice('token', token);
export const clearDeviceToken = (): Promise<void> => writeDevice('token', null);

/**
 * The key that opens the user's Gemini key, kept so that reopening the app does
 * not ask for a password again.
 *
 * Stored as a `CryptoKey`, which IndexedDB knows how to hold natively — and
 * which was derived **non-extractable**. Anything that reads this store gets
 * an object it can decrypt with, never the key material itself. That is worth
 * more than any amount of encoding on our part.
 */
export const getKek = (): Promise<CryptoKey | null> => readDevice('kek', null);
export const setKek = (kek: CryptoKey): Promise<void> => writeDevice('kek', kek);
export const clearKek = (): Promise<void> => writeDevice('kek', null);

/**
 * Without an account, the Gemini key is kept here only: sealed with a device
 * key generated on first use, non-extractable like the KEK above. Creating an
 * account moves it to the server, sealed with the account's KEK instead.
 */
export const getDeviceKek = (): Promise<CryptoKey | null> => readDevice('deviceKek', null);
export const setDeviceKek = (kek: CryptoKey): Promise<void> => writeDevice('deviceKek', kek);
export const getLocalKeyBlob = (): Promise<string | null> => readDevice('localGeminiKey', null);
export const setLocalKeyBlob = (blob: string | null): Promise<void> =>
  writeDevice('localGeminiKey', blob);

export async function getSettings(): Promise<Settings> {
  const stored = await readDevice<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export const putSettings = (value: Settings): Promise<void> => writeDevice('settings', value);

// ── Cache ────────────────────────────────────────────────────────────────────

async function write(store: CacheStore, key: string, value: unknown): Promise<void> {
  await safely(async () => {
    await (await getDb()).put(store as 'groups', value as Group, key);
  }, undefined);
}

async function read<T>(store: CacheStore, key: string): Promise<T | undefined> {
  return safely(
    async () => (await (await getDb()).get(store as 'groups', key)) as T | undefined,
    undefined,
  );
}

export const cacheGroups = (groups: GroupSummary[]): Promise<void> =>
  writeDevice('groupList', groups);

export const cachedGroups = (): Promise<GroupSummary[]> => readDevice('groupList', []);

export const cacheGroup = (group: Group): Promise<void> => write('groups', group.id, group);

export const cachedGroup = (groupId: string): Promise<Group | undefined> =>
  read<Group>('groups', groupId);

export const cacheReceiptList = (groupId: string, items: ReceiptSummary[]): Promise<void> =>
  write('receiptLists', groupId, items);

export async function cachedReceiptList(groupId: string): Promise<ReceiptSummary[]> {
  return (await read<ReceiptSummary[]>('receiptLists', groupId)) ?? [];
}

export const cacheReceipt = (receipt: Receipt): Promise<void> =>
  write('receipts', receipt.id, receipt);

export const cachedReceipt = (receiptId: string): Promise<Receipt | undefined> =>
  read<Receipt>('receipts', receiptId);

export async function dropReceipt(receiptId: string): Promise<void> {
  await safely(async () => {
    const db = await getDb();
    await db.delete('receipts', receiptId);
    await db.delete('images', receiptId);
  }, undefined);
}

export const cacheImage = (receiptId: string, blob: Blob): Promise<void> =>
  write('images', receiptId, blob);

export const cachedImage = (receiptId: string): Promise<Blob | undefined> =>
  read<Blob>('images', receiptId);

// ── Maintenance ──────────────────────────────────────────────────────────────

export async function clearCache(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.clear('groups'),
    db.clear('receipts'),
    db.clear('receiptLists'),
    db.clear('images'),
  ]);
  await writeDevice('groupList', []);
}

/** Erases everything, token included: the device becomes unknown to the server again. */
export async function forgetEverything(): Promise<void> {
  await clearCache();
  await (await getDb()).clear('device');
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

// ── Reading back the old schema (import wizard) ──────────────────────────────

export type LegacyPerson = { id: string; name: string };

export type LegacySnapshot = {
  receipts: Record<string, unknown>[];
  people: LegacyPerson[];
};

/**
 * Reads the v1-schema database, without modifying it.
 *
 * Opening without a version number avoids triggering a migration: we look at
 * what is there, and leave. A missing database, a missing store or an empty
 * database are all the same — there is nothing to import, and that is not an
 * error.
 */
export async function readLegacyData(): Promise<LegacySnapshot | null> {
  return safely(async () => {
    const db = await openDB(LEGACY_DB_NAME);
    try {
      if (!db.objectStoreNames.contains('receipts')) return null;
      const receipts = (await db.getAll('receipts')) as Record<string, unknown>[];
      if (receipts.length === 0) return null;
      const people = db.objectStoreNames.contains('people')
        ? ((await db.getAll('people')) as LegacyPerson[])
        : [];
      return { receipts, people };
    } finally {
      db.close();
    }
  }, null);
}

/** Deletes the old database. Called once the import is done, or declined. */
export async function discardLegacyData(): Promise<void> {
  await safely(async () => {
    await deleteDB(LEGACY_DB_NAME);
  }, undefined);
  await writeDevice('legacyImported', true);
}

export const wasLegacyImported = (): Promise<boolean> => readDevice('legacyImported', false);
