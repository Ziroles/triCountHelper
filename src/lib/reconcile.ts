import { settle, tipForPercent } from './compute';
import type { Assignment, Person, Receipt, ReceiptLine } from '../types';

/** How a discount on some dishes is shared between the people of those dishes. */
export type DishSplit = 'prorata' | 'equal';

/**
 * A discount "on some dishes" is kept as an adjustment assigned to people:
 * in proportion to what each one has on those dishes, or one equal share for
 * everyone on at least one of them. The API only knows two
 * modes — prorata and assigned — and would drop a list of dishes: the document
 * stores the result of the choice, and this device remembers the choice itself
 * (see `deviceMemory`) to keep the result up to date.
 */
export function assignmentsForDishes(
  lines: readonly ReceiptLine[],
  people: readonly Person[],
  split: DishSplit = 'prorata',
): Assignment[] {
  const onDishes = settle(
    {
      lines: [...lines],
      taxes: [],
      adjustments: [],
      statedTotalCents: null,
      tipCents: 0,
      tipBasis: 'subtotal',
    },
    people,
  );
  return onDishes.people
    .filter((entry) => entry.linesCents > 0)
    .map((entry) => ({
      personId: entry.personId,
      shares: split === 'equal' ? 1 : entry.linesCents,
    }));
}

function sameAssignments(a: readonly Assignment[], b: readonly Assignment[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => item.personId === b[i]?.personId && item.shares === b[i]?.shares)
  );
}

export type Intentions = {
  tipPercent?: number | undefined;
  dishes?: Record<string, string[]> | undefined;
  dishSplit?: Record<string, DishSplit> | undefined;
};

/**
 * Brings the amounts that follow a remembered intention back in line with the
 * receipt: a tip picked as a percentage follows its base, a discount on some
 * dishes follows who has those dishes. Returns null when nothing has to change,
 * so callers write nothing — and a write cannot trigger another one.
 */
export function reconcile(
  receipt: Receipt,
  people: readonly Person[],
  intentions: Intentions,
): Receipt | null {
  let next = receipt;

  if (intentions.tipPercent !== undefined) {
    const tipCents = tipForPercent(receipt, receipt.tipBasis, intentions.tipPercent);
    if (tipCents !== receipt.tipCents) next = { ...next, tipCents };
  }

  const dishes = intentions.dishes ?? {};
  if (people.length > 0 && Object.keys(dishes).length > 0) {
    let changed = false;
    const adjustments = next.adjustments.map((adjustment) => {
      const ids = dishes[adjustment.id];
      if (adjustment.mode !== 'assigned' || !ids) return adjustment;
      const lines = next.lines.filter((line) => ids.includes(line.id));
      if (lines.length === 0) return adjustment;
      const split = intentions.dishSplit?.[adjustment.id] ?? 'prorata';
      const assignments = assignmentsForDishes(lines, people, split);
      if (assignments.length === 0 || sameAssignments(assignments, adjustment.assignments)) {
        return adjustment;
      }
      changed = true;
      return { ...adjustment, assignments };
    });
    if (changed) next = { ...next, adjustments };
  }

  return next === receipt ? null : next;
}

/** The dishes a remembered discount applies to and that still exist. */
export function remainingDishes(receipt: Receipt, ids: readonly string[] | undefined): ReceiptLine[] {
  if (!ids) return [];
  return receipt.lines.filter((line) => ids.includes(line.id));
}
