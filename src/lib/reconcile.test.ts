import { describe, expect, it } from 'vitest';
import { assignmentsForDishes, reconcile } from './reconcile';
import type { Person, Receipt, ReceiptLine } from '../types';

const people: Person[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

function line(id: string, totalCents: number, who: string[]): ReceiptLine {
  return {
    id,
    label: id,
    quantity: 1,
    unitPriceCents: totalCents,
    totalCents,
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

describe('reconcile', () => {
  it('ne réécrit rien quand tout est déjà à jour', () => {
    const receipt = receiptOf({ lines: [line('x', 1000, ['a'])], tipCents: 150 });
    expect(reconcile(receipt, people, { tipPercent: 15 })).toBeNull();
    expect(reconcile(receipt, people, {})).toBeNull();
  });

  it('fait suivre au pourboire son pourcentage', () => {
    const receipt = receiptOf({ lines: [line('x', 2000, ['a'])], tipCents: 150 });
    expect(reconcile(receipt, people, { tipPercent: 15 })?.tipCents).toBe(300);
  });

  it('fait suivre à une remise les personnes de ses plats', () => {
    const receipt = receiptOf({
      lines: [line('x', 3000, ['a', 'b']), line('y', 1000, ['a'])],
      adjustments: [
        { id: 'd', label: 'Remise', amountCents: -500, mode: 'assigned', assignments: [{ personId: 'a', shares: 3000 }] },
      ],
    });
    const next = reconcile(receipt, people, { dishes: { d: ['x'] } });
    expect(next?.adjustments[0]?.assignments).toEqual([
      { personId: 'a', shares: 1500 },
      { personId: 'b', shares: 1500 },
    ]);
  });

  it('laisse une remise dont les plats ont disparu, ou repassée au prorata', () => {
    const adjustments = [
      { id: 'd', label: 'Remise', amountCents: -500, mode: 'assigned' as const, assignments: [{ personId: 'a', shares: 1 }] },
      { id: 'e', label: 'Autre', amountCents: -100, mode: 'proportional' as const, assignments: [] },
    ];
    const receipt = receiptOf({ lines: [line('y', 1000, ['b'])], adjustments });
    expect(reconcile(receipt, people, { dishes: { d: ['gone'], e: ['y'] } })).toBeNull();
  });

  it('partage entre tous un plat que personne n’a pris', () => {
    expect(assignmentsForDishes([line('x', 1000, [])], people)).toEqual([
      { personId: 'a', shares: 500 },
      { personId: 'b', shares: 500 },
    ]);
  });
});

describe('remise sur des plats, à parts égales', () => {
  const lea: Person = { id: 'l', name: 'Léa' };
  const mat: Person = { id: 'm', name: 'Mathieu' };
  const plateau = line('plateau', 3000, ['l', 'm']);
  plateau.assignments = [
    { personId: 'l', shares: 2 },
    { personId: 'm', shares: 1 },
  ];

  it('au prorata : 20,00 et 10,00 sur le plateau', () => {
    expect(assignmentsForDishes([plateau], [lea, mat], 'prorata')).toEqual([
      { personId: 'l', shares: 2000 },
      { personId: 'm', shares: 1000 },
    ]);
  });

  it('à parts égales : une part chacun', () => {
    expect(assignmentsForDishes([plateau], [lea, mat], 'equal')).toEqual([
      { personId: 'l', shares: 1 },
      { personId: 'm', shares: 1 },
    ]);
  });

  it('suit une réattribution en gardant le partage égal', () => {
    const receipt = receiptOf({
      lines: [line('x', 1000, ['a', 'b'])],
      adjustments: [
        { id: 'r1', label: 'Remise', amountCents: -500, mode: 'assigned', assignments: [{ personId: 'a', shares: 1 }] },
      ],
    });
    const next = reconcile(receipt, people, { dishes: { r1: ['x'] }, dishSplit: { r1: 'equal' } });
    expect(next?.adjustments[0]?.assignments).toEqual([
      { personId: 'a', shares: 1 },
      { personId: 'b', shares: 1 },
    ]);
  });
});
