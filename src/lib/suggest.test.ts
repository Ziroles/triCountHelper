import { describe, expect, it } from 'vitest';
import { applySuggestions, dropSuggested, undoSuggestions, wantsSuggestions } from './suggest';
import type { Person, Receipt, ReceiptLine } from '../types';

const people: Person[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

function line(id: string, who: string[] = []): ReceiptLine {
  return {
    id,
    label: id,
    quantity: 1,
    unitPriceCents: 500,
    totalCents: 500,
    taxCodes: null,
    assignments: who.map((personId) => ({ personId, shares: 1 })),
    confidence: 100,
    isManual: false,
  };
}

function receiptOf(partial: Partial<Receipt>): Receipt {
  return {
    id: 'r',
    groupId: 'g',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
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
    step: 'assign',
    ...partial,
  };
}

const NOW = '2026-11-03T10:00:00Z';
const suggest = (lineId: string, ...who: string[]) => ({
  lineId,
  assignments: who.map((personId) => ({ personId, shares: 1 })),
  seen: 1,
  occurrences: 1,
});

describe('suggestions d’attribution', () => {
  it('ne se proposent qu’une fois, et seulement s’il reste des plats à prendre', () => {
    expect(wantsSuggestions(receiptOf({ lines: [line('x')] }), people)).toBe(true);
    expect(wantsSuggestions(receiptOf({ lines: [line('x', ['a'])] }), people)).toBe(false);
    expect(wantsSuggestions(receiptOf({ lines: [line('x')], suggestedAt: NOW }), people)).toBe(false);
    expect(wantsSuggestions(receiptOf({ lines: [line('x')] }), [])).toBe(false);
  });

  it('préremplit les plats libres, pas ceux déjà pris ni pour d’anciens membres', () => {
    const receipt = receiptOf({ lines: [line('x'), line('y', ['b']), line('z')] });
    const next = applySuggestions(
      receipt,
      [suggest('x', 'a'), suggest('y', 'a'), suggest('z', 'parti'), suggest('gone', 'a')],
      people,
      NOW,
    );
    expect(next.lines.map((l) => l.assignments.map((a) => a.personId))).toEqual([['a'], ['b'], []]);
    expect(next.suggestedLineIds).toEqual(['x']);
    expect(next.suggestedAt).toBe(NOW);
  });

  it('marque le ticket même sans rien à préremplir', () => {
    const next = applySuggestions(receiptOf({ lines: [line('x')] }), [], people, NOW);
    expect(next.suggestedAt).toBe(NOW);
    expect(next.suggestedLineIds).toEqual([]);
  });

  it('oublie la suggestion d’un plat touché, et annule les autres', () => {
    const receipt = receiptOf({
      lines: [line('x', ['a']), line('y', ['b'])],
      suggestedLineIds: ['x', 'y'],
    });
    const touched = dropSuggested(receipt, ['x']);
    expect(touched.suggestedLineIds).toEqual(['y']);
    expect(dropSuggested(touched, ['x'])).toBe(touched);

    const undone = undoSuggestions(touched);
    expect(undone.lines.map((l) => l.assignments.length)).toEqual([1, 0]);
    expect(undone.suggestedLineIds).toEqual([]);
  });
});
