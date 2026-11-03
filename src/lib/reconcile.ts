import { tipForPercent } from './compute';
import type { Adjustment, DiscountSplit, Receipt, ReceiptLine } from '../types';

/** How a discount on some dishes is shared between the people of those dishes. */
export type DishSplit = DiscountSplit;

export type Intentions = {
  tipPercent?: number | undefined;
  /** Legacy: dishes of a discount written before the API kept them. */
  dishes?: Record<string, string[]> | undefined;
  dishSplit?: Record<string, DishSplit> | undefined;
};

/**
 * A discount on some dishes used to be stored as an `assigned` adjustment,
 * its dishes kept on the device that chose them. The API now keeps the dishes
 * themselves (mode `lines`): the device that remembers them hands them over,
 * once, and every device then follows the dishes.
 */
function upgradeDishDiscount(
  adjustment: Adjustment,
  lines: readonly ReceiptLine[],
  intentions: Intentions,
): Adjustment {
  const ids = intentions.dishes?.[adjustment.id];
  if (adjustment.mode !== 'assigned' || !ids) return adjustment;
  const lineIds = ids.filter((id) => lines.some((line) => line.id === id));
  // Its dishes are gone: the stored split is all that is left of the choice.
  if (lineIds.length === 0) return adjustment;
  return {
    ...adjustment,
    mode: 'lines',
    assignments: [],
    lineIds,
    split: intentions.dishSplit?.[adjustment.id] ?? 'prorata',
  };
}

/**
 * Brings the receipt in line with what this device remembers: a tip picked as
 * a percentage follows its base, a discount on some dishes chosen before the
 * API kept them is handed over. Returns null when nothing has to change, so
 * callers write nothing — and a write cannot trigger another one.
 *
 * A discount in mode `lines` needs nothing here: `settle` follows its dishes.
 */
export function reconcile(receipt: Receipt, intentions: Intentions): Receipt | null {
  let next = receipt;

  if (intentions.tipPercent !== undefined) {
    const tipCents = tipForPercent(receipt, receipt.tipBasis, intentions.tipPercent);
    if (tipCents !== receipt.tipCents) next = { ...next, tipCents };
  }

  if (intentions.dishes && Object.keys(intentions.dishes).length > 0) {
    const adjustments = next.adjustments.map((adjustment) =>
      upgradeDishDiscount(adjustment, next.lines, intentions),
    );
    if (adjustments.some((adjustment, i) => adjustment !== next.adjustments[i])) {
      next = { ...next, adjustments };
    }
  }

  return next === receipt ? null : next;
}

/** The dishes a discount applies to and that still exist. */
export function remainingDishes(receipt: Receipt, ids: readonly string[] | undefined): ReceiptLine[] {
  if (!ids) return [];
  return receipt.lines.filter((line) => ids.includes(line.id));
}
