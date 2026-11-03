/**
 * What this device remembers about a receipt, beyond what the API stores.
 *
 * The API only keeps the receipt document: amounts, not intentions. A tip
 * picked "at 18 %", a discount "on these dishes", taxes computed from their
 * rate, the payer picked, an expense already sent — none of these fit its
 * schema. They live here, in the browser, as conveniences: losing them (private
 * window, cleared storage, another device) must never change an amount, only
 * bring back the more manual behaviour.
 *
 * Every access is wrapped: storage can be missing or throw.
 */

const PREFIX = 'splitticket:';

type ReceiptMemory = {
  /** Tip percentage the user picked; the amount follows it when the base changes. */
  tipPercent?: number;
  /** Adjustment id → ids of the dishes it applies to. */
  dishes?: Record<string, string[]>;
  /** Adjustment id → how its discount is shared; absent means prorata. */
  dishSplit?: Record<string, 'prorata' | 'equal'>;
  /** Ids of taxes computed from a rate rather than read on the receipt. */
  computedTaxes?: string[];
  /** Member uuid of the person who paid. */
  payer?: string;
  /** Fingerprint of the last expense sent to Tricount. */
  sent?: { fingerprint: string; at: string };
};

const memory = new Map<string, ReceiptMemory>();

function key(receiptId: string): string {
  return `${PREFIX}receipt:${receiptId}`;
}

export function recall(receiptId: string): ReceiptMemory {
  const cached = memory.get(receiptId);
  if (cached) return cached;
  let stored: ReceiptMemory = {};
  try {
    const raw = window.localStorage.getItem(key(receiptId));
    if (raw) stored = JSON.parse(raw) as ReceiptMemory;
  } catch {
    stored = {};
  }
  memory.set(receiptId, stored);
  return stored;
}

export function remember(receiptId: string, patch: Partial<ReceiptMemory>): void {
  const next = { ...recall(receiptId), ...patch };
  for (const field of Object.keys(next) as (keyof ReceiptMemory)[]) {
    if (next[field] === undefined) delete next[field];
  }
  memory.set(receiptId, next);
  try {
    window.localStorage.setItem(key(receiptId), JSON.stringify(next));
  } catch {
    // Memory only: fine for this session.
  }
}

/** Tests start from a blank device. */
export function forgetDeviceMemory(): void {
  memory.clear();
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const name = window.localStorage.key(i);
      if (name?.startsWith(PREFIX)) window.localStorage.removeItem(name);
    }
  } catch {
    // Nothing to forget.
  }
}
