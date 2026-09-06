/**
 * API simulée pour les tests d'écran.
 *
 * Elle tient en mémoire ce que le vrai serveur tient en SQLite, avec les mêmes
 * règles là où elles comptent pour l'interface : le verrou optimiste, le
 * refus hors ligne, et l'écriture du résultat de lecture sur le ticket.
 *
 * Les tests s'en servent ainsi :
 *
 *     vi.mock('../api', () => import('../test/fakeApi'));
 *
 * `state` étant un singleton de module, le test et le code testé voient le même
 * serveur simulé.
 */

import { ApiError, OfflineError } from '../api/client';
import type {
  Group,
  GroupSummary,
  Receipt,
  ReceiptSummary,
  ServerSettings,
} from '../types';

export { ApiError, OfflineError };
export const API_BASE = '/api';
export const CONTRACT_VERSION = '1';

type FakeState = {
  groups: Map<string, Group>;
  receipts: Map<string, Receipt>;
  images: Map<string, Blob>;
  settings: ServerSettings;
  accountEmail: string | null;
  /** Résultat que `scanReceipt` appliquera au ticket, ou une erreur à lever. */
  scanResult: Partial<Receipt> | null;
  scanError: ApiError | null;
  /** Journal des dépenses envoyées vers Tricount. */
  pushed: { receiptId: string; payload: unknown }[];
  offline: boolean;
  /** Version annoncée par le serveur simulé. */
  contractVersion: string;
};

export const state: FakeState = {
  groups: new Map(),
  receipts: new Map(),
  images: new Map(),
  settings: {
    hasGeminiKey: false,
    geminiKeyHint: null,
    serverHasGeminiKey: true,
    geminiModel: 'gemini-2.5-flash',
  },
  accountEmail: null,
  scanResult: null,
  scanError: null,
  pushed: [],
  offline: false,
  contractVersion: '1',
};

export function reset(): void {
  state.groups = new Map();
  state.receipts = new Map();
  state.images = new Map();
  state.settings = {
    hasGeminiKey: false,
    geminiKeyHint: null,
    serverHasGeminiKey: true,
    geminiModel: 'gemini-2.5-flash',
  };
  state.accountEmail = null;
  state.scanResult = null;
  state.scanError = null;
  state.pushed = [];
  state.offline = false;
  state.contractVersion = '1';
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

function guard(): void {
  if (state.offline) throw new OfflineError();
}

/** Installe un groupe et ses membres, comme si l'utilisateur l'avait rejoint. */
export function seedGroup(
  title: string,
  members: { uuid: string; displayName: string }[],
  id = 'tTEST123456',
): Group {
  const group: Group = {
    id,
    title,
    currency: 'CAD',
    members: members.map((member) => ({ ...member, status: 'ACTIVE' })),
    membersSyncedAt: new Date().toISOString(),
    receiptCount: 0,
    lastActivityAt: null,
  };
  state.groups.set(id, group);
  return group;
}

/** Installe une photo déjà envoyée pour un ticket. */
export function seedImage(receiptId: string, blob: Blob): void {
  state.images.set(receiptId, blob);
}

/** Installe un ticket déjà rempli, pour ouvrir un écran sans le traverser. */
export function seedReceipt(groupId: string, partial: Partial<Receipt> = {}): Receipt {
  const now = new Date().toISOString();
  const receipt: Receipt = {
    id: nextId('receipt'),
    groupId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    imageId: null,
    merchant: null,
    purchaseDate: null,
    lines: [],
    taxes: [],
    adjustments: [],
    statedSubtotalCents: null,
    statedTotalCents: null,
    tipCents: 0,
    tipBasis: 'subtotal',
    status: 'draft',
    step: 'verify',
    ...partial,
  };
  state.receipts.set(receipt.id, receipt);
  return receipt;
}

function summarize(receipt: Receipt): ReceiptSummary {
  const total =
    receipt.lines.reduce((sum, line) => sum + line.totalCents, 0) +
    receipt.taxes.reduce((sum, tax) => sum + tax.amountCents, 0) +
    receipt.adjustments.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    id: receipt.id,
    groupId: receipt.groupId,
    merchant: receipt.merchant,
    purchaseDate: receipt.purchaseDate,
    status: receipt.status,
    step: receipt.step,
    totalCents: total,
    lineCount: receipt.lines.length,
    hasImage: receipt.imageId !== null,
    version: receipt.version,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
  };
}

// ── Surface appelée par l'application ────────────────────────────────────────

export async function health() {
  return {
    ok: true,
    contractVersion: state.contractVersion,
    serverHasGeminiKey: state.settings.serverHasGeminiKey,
    signupKeyRequired: false,
    canStoreUserKeys: true,
    imageRetentionDays: 90,
  };
}

export async function deviceToken(): Promise<string> {
  return 'jeton-de-test';
}

export async function me() {
  guard();
  return { deviceId: 'appareil-de-test', accountEmail: state.accountEmail, settings: state.settings };
}

export async function updateServerSettings(patch: {
  geminiApiKey?: string;
  geminiModel?: string;
}): Promise<ServerSettings> {
  guard();
  if (patch.geminiApiKey !== undefined) {
    const key = patch.geminiApiKey.trim();
    state.settings = {
      ...state.settings,
      hasGeminiKey: key !== '',
      geminiKeyHint: key === '' ? null : `${key.slice(0, 4)}…${key.slice(-3)}`,
    };
  }
  if (patch.geminiModel !== undefined) {
    state.settings = { ...state.settings, geminiModel: patch.geminiModel };
  }
  return state.settings;
}

export async function listModels() {
  guard();
  return [{ name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }];
}

export async function createAccount(email: string) {
  guard();
  state.accountEmail = email;
  return me();
}

export async function openSession(email: string) {
  guard();
  state.accountEmail = email;
  return me();
}

export async function listGroups(): Promise<GroupSummary[]> {
  guard();
  return [...state.groups.values()].map((group) => {
    const receipts = [...state.receipts.values()].filter((r) => r.groupId === group.id);
    return {
      id: group.id,
      title: group.title,
      currency: group.currency,
      memberCount: group.members.length,
      receiptCount: receipts.length,
      lastActivityAt: receipts.map((r) => r.updatedAt).sort().pop() ?? null,
    };
  });
}

export async function joinGroup(shareUrl: string): Promise<Group> {
  guard();
  const code = /([A-Za-z0-9]{6,})\s*$/.exec(shareUrl.trim())?.[1];
  if (!code) throw new ApiError('Lien de partage invalide.', 400, 'invalid_share_url', false);
  return state.groups.get(code) ?? seedGroup('Groupe simulé', [], code);
}

export async function readGroup(groupId: string): Promise<Group> {
  guard();
  const group = state.groups.get(groupId);
  if (!group) throw new ApiError('Groupe introuvable.', 404, 'group_not_found', false);
  return group;
}

export async function refreshMembers(groupId: string): Promise<Group> {
  return readGroup(groupId);
}

export async function leaveGroup(groupId: string): Promise<void> {
  guard();
  state.groups.delete(groupId);
}

export async function listReceipts(groupId: string): Promise<ReceiptSummary[]> {
  guard();
  return [...state.receipts.values()]
    .filter((receipt) => receipt.groupId === groupId)
    .map(summarize);
}

export async function createReceipt(groupId: string): Promise<Receipt> {
  guard();
  return seedReceipt(groupId, { step: 'capture' });
}

export async function readReceipt(receiptId: string): Promise<Receipt> {
  guard();
  const receipt = state.receipts.get(receiptId);
  if (!receipt) throw new ApiError('Ticket introuvable.', 404, 'receipt_not_found', false);
  return receipt;
}

export async function writeReceipt(receipt: Receipt): Promise<Receipt> {
  guard();
  const stored = state.receipts.get(receipt.id);
  if (!stored) throw new ApiError('Ticket introuvable.', 404, 'receipt_not_found', false);
  if (stored.version !== receipt.version) {
    throw new ApiError('Ce ticket a été modifié ailleurs.', 409, 'version_conflict', false, {
      current: stored,
    });
  }
  const saved: Receipt = {
    ...receipt,
    version: stored.version + 1,
    updatedAt: new Date().toISOString(),
  };
  state.receipts.set(saved.id, saved);
  return saved;
}

export async function deleteReceipt(receiptId: string): Promise<void> {
  guard();
  state.receipts.delete(receiptId);
}

export async function uploadImage(receiptId: string, blob: Blob): Promise<Receipt> {
  guard();
  const receipt = await readReceipt(receiptId);
  const saved = { ...receipt, imageId: nextId('image'), version: receipt.version + 1 };
  state.receipts.set(saved.id, saved);
  state.images.set(receiptId, blob);
  return saved;
}

export async function readImage(receiptId: string): Promise<Blob | null> {
  if (state.offline) return null;
  return state.images.get(receiptId) ?? null;
}

export async function scanReceipt(receiptId: string): Promise<Receipt> {
  guard();
  if (state.scanError) throw state.scanError;
  const receipt = await readReceipt(receiptId);
  const saved: Receipt = {
    ...receipt,
    ...(state.scanResult ?? {}),
    step: 'verify',
    version: receipt.version + 1,
  };
  state.receipts.set(saved.id, saved);
  return saved;
}

export async function pushExpense(receiptId: string, payload: unknown) {
  guard();
  state.pushed.push({ receiptId, payload });
  return { transactionId: 'tx-simulee' };
}
