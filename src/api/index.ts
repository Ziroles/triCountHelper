/**
 * API operations, grouped by resource.
 *
 * Each function is a request, with no state and no cache: the store decides
 * when to call and what to keep. This split makes the screens testable by
 * mocking this module, without touching the network.
 */

import { API_BASE, request, requestBlob } from './client';
import { fromWire, toWire, type WireReceipt } from './wire';
import type {
  Group,
  GroupSummary,
  Receipt,
  ReceiptSummary,
  ServerSettings,
} from '../types';

export { ApiError, OfflineError, API_BASE, CONTRACT_VERSION, deviceToken } from './client';

// ── Service ──────────────────────────────────────────────────────────────────

export type Health = {
  ok: boolean;
  contractVersion: string;
  serverHasGeminiKey: boolean;
  signupKeyRequired: boolean;
  canStoreUserKeys: boolean;
  imageRetentionDays: number;
};

/** `/health` is the only open route: it does not require a token. */
export async function health(): Promise<Health> {
  const response = await fetch(`${API_BASE}/health`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`health ${response.status}`);
  return (await response.json()) as Health;
}

// ── Identity and settings ────────────────────────────────────────────────────

export type Me = {
  deviceId: string;
  accountEmail: string | null;
  settings: ServerSettings;
};

export const me = (): Promise<Me> => request<Me>('/v1/me');

export const updateServerSettings = (
  patch: { geminiApiKey?: string; geminiModel?: string },
): Promise<ServerSettings> =>
  request<ServerSettings>('/v1/me/settings', { method: 'PUT', body: patch });

export const listModels = (): Promise<{ name: string; displayName: string }[]> =>
  request('/v1/models', { timeoutMs: 20000 });

export const createAccount = (email: string, password: string): Promise<Me> =>
  request<Me>('/v1/accounts', { method: 'POST', body: { email, password } });

export const openSession = (email: string, password: string): Promise<Me> =>
  request<Me>('/v1/sessions', { method: 'POST', body: { email, password } });

// ── Groups ───────────────────────────────────────────────────────────────────

export const listGroups = (): Promise<GroupSummary[]> => request('/v1/groups');

export const joinGroup = (shareUrl: string): Promise<Group> =>
  request<Group>('/v1/groups', { method: 'POST', body: { shareUrl }, timeoutMs: 30000 });

export const readGroup = (groupId: string): Promise<Group> =>
  request(`/v1/groups/${encodeURIComponent(groupId)}`);

export const refreshMembers = (groupId: string): Promise<Group> =>
  request(`/v1/groups/${encodeURIComponent(groupId)}/members/refresh`, {
    method: 'POST',
    timeoutMs: 30000,
  });

export const leaveGroup = (groupId: string): Promise<void> =>
  request(`/v1/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });

// ── Receipts ─────────────────────────────────────────────────────────────────

export const listReceipts = (groupId: string): Promise<ReceiptSummary[]> =>
  request(`/v1/groups/${encodeURIComponent(groupId)}/receipts`);

export async function createReceipt(groupId: string): Promise<Receipt> {
  const wire = await request<WireReceipt>(
    `/v1/groups/${encodeURIComponent(groupId)}/receipts`,
    { method: 'POST' },
  );
  return fromWire(wire);
}

export async function readReceipt(receiptId: string): Promise<Receipt> {
  return fromWire(await request<WireReceipt>(`/v1/receipts/${encodeURIComponent(receiptId)}`));
}

export async function writeReceipt(receipt: Receipt): Promise<Receipt> {
  const wire = await request<WireReceipt>(`/v1/receipts/${encodeURIComponent(receipt.id)}`, {
    method: 'PUT',
    body: toWire(receipt),
  });
  return fromWire(wire);
}

export const deleteReceipt = (receiptId: string): Promise<void> =>
  request(`/v1/receipts/${encodeURIComponent(receiptId)}`, { method: 'DELETE' });

export async function uploadImage(receiptId: string, blob: Blob): Promise<Receipt> {
  const form = new FormData();
  form.append('file', blob, 'ticket.jpg');
  const wire = await request<WireReceipt>(
    `/v1/receipts/${encodeURIComponent(receiptId)}/image`,
    { method: 'POST', form, timeoutMs: 60000 },
  );
  return fromWire(wire);
}

export const readImage = (receiptId: string): Promise<Blob | null> =>
  requestBlob(`/v1/receipts/${encodeURIComponent(receiptId)}/image`);

/**
 * Starts the OCR pass. The server writes the result onto the receipt before
 * answering: if the request does not complete, reopening the receipt still
 * shows the reading. The timeout is generous — a vision model takes a handful
 * of seconds, and giving up too early wastes a call that has already been paid
 * for.
 */
export async function scanReceipt(receiptId: string): Promise<Receipt> {
  const wire = await request<WireReceipt>(`/v1/receipts/${encodeURIComponent(receiptId)}/scan`, {
    method: 'POST',
    timeoutMs: 120000,
  });
  return fromWire(wire);
}

export type PushShare = { memberUuid: string; amountCents: number };

export const pushExpense = (
  receiptId: string,
  payload: {
    description: string;
    totalCents: number;
    payerMemberUuid: string;
    shares: PushShare[];
    date: string | null;
  },
): Promise<{ transactionId: string }> =>
  request(`/v1/receipts/${encodeURIComponent(receiptId)}/push`, {
    method: 'POST',
    body: payload,
    timeoutMs: 30000,
  });
