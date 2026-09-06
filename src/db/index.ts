/**
 * IndexedDB : cache de lecture et préférences d'appareil.
 *
 * Ce module a changé de rôle. Il ne détient plus la vérité — c'est l'API qui la
 * détient, depuis que les tickets sont partagés entre les membres d'un groupe.
 * Il garde ici :
 *
 *  - le **jeton d'appareil**, seule donnée réellement indispensable ;
 *  - un **cache** des groupes, tickets et photos déjà consultés, pour que
 *    l'application reste lisible hors ligne ;
 *  - les **préférences d'affichage** (thème, régime fiscal, pourboire par
 *    défaut), qui n'intéressent personne d'autre que cet appareil.
 *
 * Rien de ce qui est écrit ici n'est renvoyé au serveur : le cache est jetable,
 * et une lecture qui échoue vaut mieux qu'une écriture inventée.
 *
 * La nouvelle base porte un **nom distinct** de l'ancienne. Migrer en place
 * aurait obligé à supprimer les anciens magasins pour recréer les nouveaux sous
 * les mêmes noms — et donc à détruire précisément ce que l'assistant d'import
 * doit encore pouvoir lire. Deux bases coexistent le temps de l'import ;
 * l'ancienne est supprimée une fois qu'il a abouti.
 */

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_SETTINGS,
  type Group,
  type GroupSummary,
  type Receipt,
  type ReceiptSummary,
  type Settings,
} from '../types';

const DB_NAME = 'splitticket-app';
const DB_VERSION = 1;

const LEGACY_DB_NAME = 'splitticket';

type CacheStore = 'groups' | 'receipts' | 'receiptLists' | 'images';

interface SplitTicketDB extends DBSchema {
  /** Identité de l'appareil et préférences locales. Clefs en ligne. */
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
        // Clefs hors ligne : la valeur stockée est la donnée nue, sans champ
        // technique ajouté pour la retrouver.
        db.createObjectStore('groups');
        db.createObjectStore('receipts');
        db.createObjectStore('receiptLists');
        db.createObjectStore('images');
      },
    });
  }
  return dbPromise;
}

/** Le cache ne doit jamais faire échouer un écran : une panne locale rend `undefined`. */
async function safely<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch {
    return fallback;
  }
}

// ── Identité et préférences ──────────────────────────────────────────────────

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

// ── Entretien ────────────────────────────────────────────────────────────────

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

/** Efface tout, jeton compris : l'appareil redeviendra inconnu du serveur. */
export async function forgetEverything(): Promise<void> {
  await clearCache();
  await (await getDb()).clear('device');
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

// ── Relecture de l'ancien schéma (assistant d'import) ────────────────────────

export type LegacyPerson = { id: string; name: string };

export type LegacySnapshot = {
  receipts: Record<string, unknown>[];
  people: LegacyPerson[];
};

/**
 * Lit la base du schéma v1, sans la modifier.
 *
 * Ouvrir sans numéro de version évite de déclencher une migration : on regarde
 * ce qui est là, et on repart. Absence de base, absence de magasin ou base vide
 * se valent — il n'y a rien à importer, et ce n'est pas une erreur.
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

/** Supprime l'ancienne base. Appelé une fois l'import terminé, ou refusé. */
export async function discardLegacyData(): Promise<void> {
  await safely(async () => {
    await deleteDB(LEGACY_DB_NAME);
  }, undefined);
  await writeDevice('legacyImported', true);
}

export const wasLegacyImported = (): Promise<boolean> => readDevice('legacyImported', false);
