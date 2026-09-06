import { describe, expect, it } from 'vitest';
import { fromWire, toWire, type WireReceipt } from './wire';
import type { Receipt } from '../types';

/**
 * La frontière domaine ↔ API.
 *
 * Un seul champ change de nom (`personId` ↔ `memberUuid`), mais il est niché
 * dans deux collections imbriquées. C'est exactement le genre de traduction
 * qu'on oublie d'appliquer à moitié — d'où ces tests, qui vérifient surtout
 * l'aller-retour complet.
 */

const receipt: Receipt = {
  id: 'r1',
  groupId: 'tABC123456',
  createdAt: '2026-03-14T10:00:00Z',
  updatedAt: '2026-03-14T10:00:00Z',
  version: 3,
  imageId: 'img-1',
  merchant: 'IGA',
  purchaseDate: '2026-03-14',
  lines: [
    {
      id: 'l1',
      label: 'Pain',
      description: null,
      quantity: 1,
      unitPriceCents: 349,
      totalCents: 349,
      taxCodes: [],
      assignments: [
        { personId: 'm-lea', shares: 2 },
        { personId: 'm-mathieu', shares: 1 },
      ],
      confidence: 95,
      isManual: false,
    },
  ],
  taxes: [{ id: 't1', label: 'TPS', code: 'TPS', ratePercent: 5, amountCents: 17 }],
  adjustments: [
    {
      id: 'a1',
      label: 'Remise',
      amountCents: -100,
      mode: 'assigned',
      assignments: [{ personId: 'm-lea', shares: 1 }],
    },
  ],
  statedSubtotalCents: 349,
  statedTotalCents: 366,
  tipCents: 0,
  tipBasis: 'subtotal',
  status: 'draft',
  step: 'assign',
};

describe('traduction domaine ↔ API', () => {
  it('renomme personId en memberUuid dans les lignes et les ajustements', () => {
    const wire = toWire(receipt);

    expect(wire.lines[0]?.assignments).toEqual([
      { memberUuid: 'm-lea', shares: 2 },
      { memberUuid: 'm-mathieu', shares: 1 },
    ]);
    expect(wire.adjustments[0]?.assignments).toEqual([{ memberUuid: 'm-lea', shares: 1 }]);
    // Aucun `personId` ne doit fuir sur le fil.
    expect(JSON.stringify(wire)).not.toContain('personId');
  });

  it('fait l’aller-retour sans rien perdre', () => {
    expect(fromWire(toWire(receipt))).toEqual(receipt);
  });

  it('conserve les parts inégales, qui ne sont pas des booléens', () => {
    const back = fromWire(toWire(receipt));
    expect(back.lines[0]?.assignments.map((a) => a.shares)).toEqual([2, 1]);
  });

  it('survit à une réponse où les collections sont absentes', () => {
    const partial = {
      id: 'r2',
      groupId: 'g',
      createdAt: 'x',
      updatedAt: 'x',
      version: 1,
      imageId: null,
      merchant: null,
      purchaseDate: null,
      statedSubtotalCents: null,
      statedTotalCents: null,
      tipCents: 0,
      tipBasis: 'subtotal',
      status: 'draft',
      step: 'capture',
    } as unknown as WireReceipt;

    const receipt = fromWire(partial);
    expect(receipt.lines).toEqual([]);
    expect(receipt.taxes).toEqual([]);
    expect(receipt.adjustments).toEqual([]);
  });

  it('laisse tomber une part sans membre plutôt que d’inventer un propriétaire', () => {
    const wire = {
      ...toWire(receipt),
      lines: [{ ...toWire(receipt).lines[0]!, assignments: [] }],
    };
    expect(fromWire(wire).lines[0]?.assignments).toEqual([]);
  });
});
