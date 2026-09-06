/**
 * Modèle de domaine du client.
 *
 * Un « participant » est désormais un membre du tricount : son `id` est l'uuid
 * que Tricount lui donne. Le champ garde son nom de domaine — `personId` — plutôt
 * que d'adopter `memberUuid` : `lib/compute.ts` répartit de l'argent entre des
 * personnes, et n'a pas à savoir d'où ces personnes viennent. La traduction vers
 * le vocabulaire de l'API se fait à la frontière, dans `api/receipts.ts`, et
 * nulle part ailleurs.
 */

export type Person = {
  id: string;
  name: string;
  color?: string;
};

/** Membre d'un tricount, tel que l'API le rend. */
export type Member = {
  uuid: string;
  displayName: string;
  status: string;
};

/** Un groupe est un tricount ; son identifiant est le code d'invitation. */
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
  /** Uuid du membre Tricount à qui revient cette part. */
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
  /** Verrou optimiste : le serveur refuse une écriture partie d'une version périmée. */
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

/** Vue allégée pour la liste des tickets d'un groupe. */
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
 * Réglages d'affichage, propres à l'appareil.
 *
 * La clé Gemini n'est plus ici : elle vit côté serveur, chiffrée, et ne
 * redescend jamais entière. Voir `ServerSettings`.
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

/** Réglages détenus par l'API pour le compte de cet utilisateur. */
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
