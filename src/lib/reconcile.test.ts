import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile';
import type { Adjustment, Receipt, ReceiptLine } from '../types';

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

const legacy: Adjustment = {
  id: 'd',
  label: 'Remise',
  amountCents: -500,
  mode: 'assigned',
  assignments: [{ personId: 'a', shares: 3000 }],
};

describe('reconcile', () => {
  it('ne réécrit rien quand tout est déjà à jour', () => {
    const receipt = receiptOf({ lines: [line('x', 1000, ['a'])], tipCents: 150 });
    expect(reconcile(receipt, { tipPercent: 15 })).toBeNull();
    expect(reconcile(receipt, {})).toBeNull();
  });

  it('fait suivre au pourboire son pourcentage', () => {
    const receipt = receiptOf({ lines: [line('x', 2000, ['a'])], tipCents: 150 });
    expect(reconcile(receipt, { tipPercent: 15 })?.tipCents).toBe(300);
  });
});

describe('reconcile — remises sur des plats d’avant', () => {
  it('confie au ticket les plats retenus sur cet appareil', () => {
    const receipt = receiptOf({
      lines: [line('x', 3000, ['a', 'b']), line('y', 1000, ['a'])],
      adjustments: [legacy],
    });
    const next = reconcile(receipt, { dishes: { d: ['x', 'gone'] }, dishSplit: { d: 'equal' } });
    expect(next?.adjustments[0]).toEqual({
      ...legacy,
      mode: 'lines',
      assignments: [],
      lineIds: ['x'],
      split: 'equal',
    });
  });

  it('prend le prorata quand le partage n’était pas retenu', () => {
    const receipt = receiptOf({ lines: [line('x', 3000, ['a'])], adjustments: [legacy] });
    expect(reconcile(receipt, { dishes: { d: ['x'] } })?.adjustments[0]?.split).toBe('prorata');
  });

  it('laisse une remise dont les plats ont disparu, ou qui n’est pas sur des plats', () => {
    const other: Adjustment = { ...legacy, id: 'e', mode: 'proportional', assignments: [] };
    const receipt = receiptOf({ lines: [line('y', 1000, ['b'])], adjustments: [legacy, other] });
    expect(reconcile(receipt, { dishes: { d: ['gone'], e: ['y'] } })).toBeNull();
  });

  it('ne touche plus une remise déjà passée sur ses plats', () => {
    const receipt = receiptOf({
      lines: [line('x', 1000, ['a'])],
      adjustments: [{ ...legacy, mode: 'lines', assignments: [], lineIds: ['x'] }],
    });
    expect(reconcile(receipt, { dishes: { d: ['x'] } })).toBeNull();
  });
});
