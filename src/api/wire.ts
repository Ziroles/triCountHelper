/**
 * Boundary between the domain's vocabulary and the API's.
 *
 * Only one thing differs, but it is everywhere: a share is assigned to a
 * `personId` on the domain side, to a `memberUuid` on the wire. Both carry the
 * same value — the uuid of a Tricount member — and each name is right at home:
 *
 *  - `lib/compute.ts` splits money between people. Talking to it about Tricount
 *    would pull the integration into the computation core, which has no need of
 *    it and which is the most heavily tested part of the application.
 *  - the server, for its part, validates those identifiers against the tricount's
 *    real members. `memberUuid` is the honest name there.
 *
 * The translation fits in this file, and in this file only.
 */

import type { Adjustment, Assignment, Receipt, ReceiptLine } from '../types';

type WireAssignment = { memberUuid: string; shares: number };

type WireLine = Omit<ReceiptLine, 'assignments'> & { assignments: WireAssignment[] };
type WireAdjustment = Omit<Adjustment, 'assignments'> & { assignments: WireAssignment[] };

export type WireReceipt = Omit<Receipt, 'lines' | 'adjustments'> & {
  lines: WireLine[];
  adjustments: WireAdjustment[];
};

const toWireAssignments = (assignments: Assignment[]): WireAssignment[] =>
  assignments.map(({ personId, shares }) => ({ memberUuid: personId, shares }));

const fromWireAssignments = (assignments: WireAssignment[] | undefined): Assignment[] =>
  (assignments ?? []).map(({ memberUuid, shares }) => ({ personId: memberUuid, shares }));

/** Domain receipt → request body. */
export function toWire(receipt: Receipt): WireReceipt {
  return {
    ...receipt,
    lines: receipt.lines.map((line) => ({
      ...line,
      assignments: toWireAssignments(line.assignments),
    })),
    adjustments: receipt.adjustments.map((adjustment) => ({
      ...adjustment,
      assignments: toWireAssignments(adjustment.assignments),
    })),
  };
}

/** API response → domain receipt. */
export function fromWire(wire: WireReceipt): Receipt {
  return {
    ...wire,
    lines: (wire.lines ?? []).map((line) => ({
      ...line,
      assignments: fromWireAssignments(line.assignments),
    })),
    taxes: wire.taxes ?? [],
    adjustments: (wire.adjustments ?? []).map((adjustment) => ({
      ...adjustment,
      assignments: fromWireAssignments(adjustment.assignments),
    })),
  };
}
