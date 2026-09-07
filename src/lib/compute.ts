import { splitCents } from './split';
import { sumCents } from './money';
import type {
  Adjustment,
  Assignment,
  Person,
  Receipt,
  ReceiptLine,
  ReceiptTax,
  TipBasis,
} from '../types';

export type PersonShareItem = {
  kind: 'line' | 'tax' | 'adjustment' | 'tip';
  id: string;
  label: string;
  description?: string | null;
  totalCents: number;
  amountCents: number;
  /** Number of people sharing this portion (1 = alone). */
  shareCount: number;
  /** True when the line was assigned to nobody and follows the default split. */
  auto: boolean;
};

export type PersonTotals = {
  personId: string;
  linesCents: number;
  taxesCents: number;
  adjustmentsCents: number;
  tipCents: number;
  totalCents: number;
  lineCount: number;
  /** Lines the person takes on alone. */
  soloLineCount: number;
  /** Lines shared with at least one other person. */
  sharedLineCount: number;
  ratio: number;
  items: PersonShareItem[];
};

export type TaxBreakdown = {
  taxId: string;
  code: string;
  label: string;
  amountCents: number;
  baseCents: number;
  fellBack: boolean;
};

export type Settlement = {
  people: PersonTotals[];
  subtotalCents: number;
  assignedSubtotalCents: number;
  unassignedLinesCents: number;
  unassignedLineIds: string[];
  /** Lines with no explicit assignment, split automatically between all participants. */
  autoSplitLineIds: string[];
  autoSplitLinesCents: number;
  taxes: TaxBreakdown[];
  taxesTotalCents: number;
  adjustmentsTotalCents: number;
  tipCents: number;
  receiptTotalCents: number;
  distributedTotalCents: number;
  statedDiscrepancyCents: number | null;
};

export function isAssigned(line: ReceiptLine): boolean {
  return line.assignments.some((a) => Number.isFinite(a.shares) && a.shares > 0);
}

export function isTaxable(line: ReceiptLine): boolean {
  return line.taxCodes === null || line.taxCodes.length > 0;
}

export function appliesTo(line: ReceiptLine, tax: ReceiptTax): boolean {
  return line.taxCodes === null || line.taxCodes.includes(tax.code);
}

export function subtotalOf(receipt: Pick<Receipt, 'lines'>): number {
  return sumCents(receipt.lines.map((l) => l.totalCents));
}

export function taxesTotalOf(taxes: readonly ReceiptTax[]): number {
  return sumCents(taxes.map((t) => t.amountCents));
}

export function adjustmentsTotal(adjustments: readonly Adjustment[]): number {
  return sumCents(adjustments.map((a) => a.amountCents));
}

export function receiptTotal(
  receipt: Pick<Receipt, 'lines' | 'taxes' | 'adjustments'>,
): number {
  return (
    subtotalOf(receipt) + taxesTotalOf(receipt.taxes) + adjustmentsTotal(receipt.adjustments)
  );
}

export function tipForPercent(
  receipt: Pick<Receipt, 'lines' | 'taxes' | 'adjustments'>,
  basis: TipBasis,
  percent: number,
): number {
  const base =
    basis === 'subtotal'
      ? subtotalOf(receipt)
      : subtotalOf(receipt) + taxesTotalOf(receipt.taxes) + adjustmentsTotal(receipt.adjustments);
  if (!Number.isFinite(percent) || percent <= 0 || base <= 0) return 0;
  return Math.round((base * percent) / 100);
}

type SettleInput = Pick<
  Receipt,
  'lines' | 'taxes' | 'adjustments' | 'statedTotalCents' | 'tipCents' | 'tipBasis'
>;

export function settle(input: SettleInput, people: readonly Person[]): Settlement {
  const index = new Map(people.map((p, i) => [p.id, i]));
  const count = people.length;
  const order = people.map((_, i) => i);

  const lines = new Array<number>(count).fill(0);
  const taxes = new Array<number>(count).fill(0);
  const adjustments = new Array<number>(count).fill(0);
  const tips = new Array<number>(count).fill(0);
  const lineCounts = new Array<number>(count).fill(0);
  const soloLineCounts = new Array<number>(count).fill(0);
  const sharedLineCounts = new Array<number>(count).fill(0);
  const items: PersonShareItem[][] = people.map(() => []);

  const taxBase = new Map<string, number[]>();
  for (const tax of input.taxes) taxBase.set(tax.code, new Array<number>(count).fill(0));

  const unassignedLineIds: string[] = [];
  const autoSplitLineIds: string[] = [];
  let assignedSubtotalCents = 0;
  let autoSplitLinesCents = 0;

  /* A line nobody claimed goes to everyone, in equal shares. With no
     participants there is nobody to give it to: it stays out of the split. */
  const everyone: Assignment[] = people.map((person) => ({ personId: person.id, shares: 1 }));

  for (const line of input.lines) {
    const explicit = isAssigned(line)
      ? line.assignments.filter((a) => index.has(a.personId) && a.shares > 0)
      : [];
    const auto = explicit.length === 0;
    const targets = auto ? everyone : explicit;

    if (targets.length === 0) {
      unassignedLineIds.push(line.id);
      continue;
    }
    if (auto) {
      autoSplitLineIds.push(line.id);
      autoSplitLinesCents += line.totalCents;
    }
    assignedSubtotalCents += line.totalCents;

    const tieBreak = targets.map((a) => index.get(a.personId) as number);
    const weights = targets.map((a) => a.shares);
    const parts = splitCents(line.totalCents, weights, { tieBreak });
    const shareCount = targets.length;

    targets.forEach((assignment, i) => {
      const p = index.get(assignment.personId) as number;
      const amount = parts[i] as number;
      lines[p] = (lines[p] as number) + amount;
      lineCounts[p] = (lineCounts[p] as number) + 1;
      if (shareCount > 1) sharedLineCounts[p] = (sharedLineCounts[p] as number) + 1;
      else soloLineCounts[p] = (soloLineCounts[p] as number) + 1;
      (items[p] as PersonShareItem[]).push({
        kind: 'line',
        id: line.id,
        label: line.label,
        description: line.description ?? null,
        totalCents: line.totalCents,
        amountCents: amount,
        shareCount,
        auto,
      });

      for (const tax of input.taxes) {
        if (!appliesTo(line, tax)) continue;
        const base = taxBase.get(tax.code) as number[];
        base[p] = (base[p] as number) + amount;
      }
    });
  }

  const breakdown: TaxBreakdown[] = [];
  for (const tax of input.taxes) {
    const base = taxBase.get(tax.code) as number[];
    const baseCents = sumCents(base);
    const fellBack = baseCents <= 0;
    const weights = fellBack ? lines.map((value) => (value > 0 ? value : 0)) : base;

    breakdown.push({
      taxId: tax.id,
      code: tax.code,
      label: tax.label,
      amountCents: tax.amountCents,
      baseCents,
      fellBack,
    });

    if (weights.every((w) => w <= 0)) continue;
    const parts = splitCents(tax.amountCents, weights, { tieBreak: order });
    parts.forEach((amount, p) => {
      if (amount === 0) return;
      taxes[p] = (taxes[p] as number) + amount;
      (items[p] as PersonShareItem[]).push({
        kind: 'tax',
        id: tax.id,
        label: tax.label,
        totalCents: tax.amountCents,
        amountCents: amount,
        shareCount: 0,
        auto: false,
      });
    });
  }

  for (const adjustment of input.adjustments) {
    let targetIndexes: number[];
    let weights: number[];

    if (adjustment.mode === 'assigned') {
      const targets = adjustment.assignments.filter(
        (a) => index.has(a.personId) && a.shares > 0,
      );
      if (targets.length === 0) continue;
      targetIndexes = targets.map((a) => index.get(a.personId) as number);
      weights = targets.map((a) => a.shares);
    } else {
      targetIndexes = order;
      weights = order.map((i) => {
        const due = (lines[i] as number) + (taxes[i] as number) + (adjustments[i] as number);
        return due > 0 ? due : 0;
      });
      if (weights.every((w) => w === 0)) {
        const involved = order.filter((i) => (lineCounts[i] as number) > 0);
        const pool = involved.length > 0 ? involved : order;
        weights = order.map((i) => (pool.includes(i) ? 1 : 0));
      }
      if (weights.every((w) => w === 0)) continue;
    }

    const parts = splitCents(adjustment.amountCents, weights, { tieBreak: targetIndexes });
    targetIndexes.forEach((p, i) => {
      const amount = parts[i] as number;
      if (amount === 0 && (weights[i] as number) === 0) return;
      adjustments[p] = (adjustments[p] as number) + amount;
      (items[p] as PersonShareItem[]).push({
        kind: 'adjustment',
        id: adjustment.id,
        label: adjustment.label,
        totalCents: adjustment.amountCents,
        amountCents: amount,
        shareCount: 0,
        auto: false,
      });
    });
  }

  const tipCents = Number.isFinite(input.tipCents) ? Math.round(input.tipCents) : 0;
  if (tipCents !== 0) {
    const weights = order.map((i) => {
      const base =
        input.tipBasis === 'subtotal'
          ? (lines[i] as number)
          : (lines[i] as number) + (taxes[i] as number) + (adjustments[i] as number);
      return base > 0 ? base : 0;
    });
    if (!weights.every((w) => w === 0)) {
      const parts = splitCents(tipCents, weights, { tieBreak: order });
      parts.forEach((amount, p) => {
        if (amount === 0) return;
        tips[p] = amount;
        (items[p] as PersonShareItem[]).push({
          kind: 'tip',
          id: 'tip',
          label: 'Pourboire',
          totalCents: tipCents,
          amountCents: amount,
          shareCount: 0,
          auto: false,
        });
      });
    }
  }

  const totals = order.map(
    (i) =>
      (lines[i] as number) +
      (taxes[i] as number) +
      (adjustments[i] as number) +
      (tips[i] as number),
  );
  const distributedTotalCents = sumCents(totals);

  const subtotalCents = subtotalOf(input);
  const taxesTotalCents = taxesTotalOf(input.taxes);
  const adjustmentsTotalCents = adjustmentsTotal(input.adjustments);
  const receiptTotalCents = subtotalCents + taxesTotalCents + adjustmentsTotalCents;

  return {
    people: people.map((person, i) => ({
      personId: person.id,
      linesCents: lines[i] as number,
      taxesCents: taxes[i] as number,
      adjustmentsCents: adjustments[i] as number,
      tipCents: tips[i] as number,
      totalCents: totals[i] as number,
      lineCount: lineCounts[i] as number,
      soloLineCount: soloLineCounts[i] as number,
      sharedLineCount: sharedLineCounts[i] as number,
      ratio: distributedTotalCents === 0 ? 0 : (totals[i] as number) / distributedTotalCents,
      items: items[i] as PersonShareItem[],
    })),
    subtotalCents,
    assignedSubtotalCents,
    unassignedLinesCents: subtotalCents - assignedSubtotalCents,
    unassignedLineIds,
    autoSplitLineIds,
    autoSplitLinesCents,
    taxes: breakdown,
    taxesTotalCents,
    adjustmentsTotalCents,
    tipCents,
    receiptTotalCents,
    distributedTotalCents,
    statedDiscrepancyCents:
      input.statedTotalCents === null || input.statedTotalCents === undefined
        ? null
        : receiptTotalCents - input.statedTotalCents,
  };
}
