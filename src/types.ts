/**
 * The client's domain model.
 *
 * A "participant" is now a member of the tricount: their `id` is the uuid
 * Tricount gives them. The field keeps its domain name — `personId` — rather
 * than adopting `memberUuid`: `lib/compute.ts` splits money between people, and
 * has no business knowing where those people come from. The translation to the
 * API's vocabulary happens at the boundary, in `api/receipts.ts`, and nowhere
 * else.
 */

export type Person = {
  id: string;
  name: string;
  color?: string;
};

/** Member of a tricount, as the API returns it. */
export type Member = {
  uuid: string;
  displayName: string;
  status: string;
};

/** A group is a tricount; its identifier is the invitation code. */
export type Group = {
  id: string;
  title: string;
  currency: string;
  members: Member[];
  membersSyncedAt: string | null;
  receiptCount: number;
  lastActivityAt: string | null;
};

export type GroupSummary = {
  id: string;
  title: string;
  currency: string;
  memberCount: number;
  receiptCount: number;
  lastActivityAt: string | null;
};

export type ReceiptTax = {
  id: string;
  label: string;
  code: string;
  ratePercent: number | null;
  amountCents: number;
};

export type TaxRegime = {
  code: string;
  label: string;
  taxes: { code: string; label: string; ratePercent: number }[];
};

export const TAX_REGIMES: TaxRegime[] = [
  {
    code: 'QC',
    label: 'Québec',
    taxes: [
      { code: 'TPS', label: 'TPS', ratePercent: 5 },
      { code: 'TVQ', label: 'TVQ', ratePercent: 9.975 },
    ],
  },
  {
    code: 'ON',
    label: 'Ontario',
    taxes: [{ code: 'TVH', label: 'TVH', ratePercent: 13 }],
  },
  {
    code: 'GST',
    label: 'TPS seule (AB, T.N.-O., Nt, Yn)',
    taxes: [{ code: 'TPS', label: 'TPS', ratePercent: 5 }],
  },
];

export const DEFAULT_REGIME_CODE = 'QC';

export function regimeByCode(code: string): TaxRegime {
  return TAX_REGIMES.find((regime) => regime.code === code) ?? (TAX_REGIMES[0] as TaxRegime);
}

export type Assignment = {
  /** Uuid of the Tricount member this share belongs to. */
  personId: string;
  shares: number;
};

export type ReceiptLine = {
  id: string;
  label: string;
  description?: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  taxCodes: string[] | null;
  assignments: Assignment[];
  confidence: number;
  isManual: boolean;
};

export type AdjustmentMode = 'proportional' | 'assigned';

export type Adjustment = {
  id: string;
  label: string;
  amountCents: number;
  mode: AdjustmentMode;
  assignments: Assignment[];
};

export type ReceiptStatus = 'draft' | 'settled';

export type ReceiptStep = 'capture' | 'processing' | 'verify' | 'assign' | 'results';

export type TipBasis = 'subtotal' | 'total';

export type Receipt = {
  id: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  /** Optimistic lock: the server refuses a write started from a stale version. */
  version: number;
  imageId: string | null;
  merchant: string | null;
  purchaseDate: string | null;
  lines: ReceiptLine[];
  taxes: ReceiptTax[];
  adjustments: Adjustment[];
  statedSubtotalCents: number | null;
  statedTotalCents: number | null;
  tipCents: number;
  tipBasis: TipBasis;
  status: ReceiptStatus;
  step: ReceiptStep;
};

/** Lightweight view for a group's receipt list. */
export type ReceiptSummary = {
  id: string;
  groupId: string;
  merchant: string | null;
  purchaseDate: string | null;
  status: ReceiptStatus;
  step: ReceiptStep;
  totalCents: number;
  lineCount: number;
  hasImage: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Display settings, specific to the device.
 *
 * The Gemini key is no longer here: it lives on the server, encrypted, and
 * never comes back down in full. See `ServerSettings`.
 */
export type Settings = {
  taxRegimeCode: string;
  defaultTipPercent: number;
  defaultTipBasis: TipBasis;
  theme: 'system' | 'light' | 'dark';
};

export const DEFAULT_SETTINGS: Settings = {
  taxRegimeCode: DEFAULT_REGIME_CODE,
  defaultTipPercent: 18,
  defaultTipBasis: 'subtotal',
  theme: 'system',
};

/** Settings held by the API on this user's behalf. */
export type ServerSettings = {
  hasGeminiKey: boolean;
  geminiKeyHint: string | null;
  serverHasGeminiKey: boolean;
  geminiModel: string;
};

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  hasGeminiKey: false,
  geminiKeyHint: null,
  serverHasGeminiKey: false,
  geminiModel: '',
};
