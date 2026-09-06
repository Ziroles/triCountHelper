/**
 * Frontière entre le vocabulaire du domaine et celui de l'API.
 *
 * Une seule chose diffère, mais elle est partout : une part est attribuée à un
 * `personId` côté domaine, à un `memberUuid` sur le fil. Les deux portent la
 * même valeur — l'uuid d'un membre Tricount — et chaque nom est juste chez lui :
 *
 *  - `lib/compute.ts` répartit de l'argent entre des personnes. Lui parler de
 *    Tricount ferait entrer l'intégration dans le noyau de calcul, qui n'en a
 *    aucun besoin et qui est la partie la plus testée de l'application.
 *  - le serveur, lui, valide ces identifiants contre les membres réels du
 *    tricount. `memberUuid` y est le nom honnête.
 *
 * La traduction tient dans ce fichier, et dans ce fichier seulement.
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

/** Ticket du domaine → corps de requête. */
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

/** Réponse de l'API → ticket du domaine. */
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
