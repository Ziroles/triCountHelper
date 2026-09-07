import { describe, expect, it } from 'vitest';
import { settle, tipForPercent } from './compute';
import { sumCents } from './money';
import type { Adjustment, Person, ReceiptLine, ReceiptTax } from '../types';

const people: Person[] = [
  { id: 'p1', name: 'Mathieu' },
  { id: 'p2', name: 'Léa' },
  { id: 'p3', name: 'Sam' },
];

function line(
  id: string,
  totalCents: number,
  assignments: { personId: string; shares?: number }[],
  taxCodes: string[] | null = null,
): ReceiptLine {
  return {
    id,
    label: `Article ${id}`,
    quantity: 1,
    unitPriceCents: totalCents,
    totalCents,
    taxCodes,
    assignments: assignments.map((a) => ({ personId: a.personId, shares: a.shares ?? 1 })),
    confidence: 100,
    isManual: true,
  };
}

const TPS = (amountCents: number): ReceiptTax => ({
  id: 'tps',
  code: 'TPS',
  label: 'TPS',
  ratePercent: 5,
  amountCents,
});

const TVQ = (amountCents: number): ReceiptTax => ({
  id: 'tvq',
  code: 'TVQ',
  label: 'TVQ',
  ratePercent: 9.975,
  amountCents,
});

function receiptOf(
  lines: ReceiptLine[],
  taxes: ReceiptTax[] = [],
  extra: Partial<Parameters<typeof settle>[0]> = {},
) {
  return {
    lines,
    taxes,
    adjustments: [],
    statedTotalCents: null,
    tipCents: 0,
    tipBasis: 'subtotal' as const,
    ...extra,
  };
}

describe('settle — invariants', () => {
  it('conserve un cent partagé à trois', () => {
    const r = receiptOf([line('l1', 1, [{ personId: 'p1' }, { personId: 'p2' }, { personId: 'p3' }])]);
    const s = settle(r, people);
    expect(sumCents(s.people.map((p) => p.totalCents))).toBe(1);
  });

  it('répartit 10,00 $ entre trois personnes sans perdre un cent', () => {
    const r = receiptOf([line('l1', 1000, [{ personId: 'p1' }, { personId: 'p2' }, { personId: 'p3' }])]);
    expect(settle(r, people).people.map((p) => p.totalCents)).toEqual([334, 333, 333]);
  });

  it('applique une répartition 70/30', () => {
    const r = receiptOf([
      line('l1', 4782, [
        { personId: 'p1', shares: 70 },
        { personId: 'p2', shares: 30 },
      ]),
    ]);
    const s = settle(r, people);
    expect(s.people.map((p) => p.totalCents)).toEqual([3347, 1435, 0]);
  });

  it('est idempotent', () => {
    const r = receiptOf(
      [line('l1', 999, [{ personId: 'p1' }, { personId: 'p2' }, { personId: 'p3' }])],
      [TPS(50), TVQ(100)],
      { tipCents: 333 },
    );
    expect(settle(r, people)).toEqual(settle(r, people));
  });
});

describe('settle — taxes canadiennes', () => {
  it('ajoute les taxes au montant dû, elles ne sont pas décoratives', () => {
    const r = receiptOf([line('l1', 4250, [{ personId: 'p1' }])], [TPS(213), TVQ(424)]);
    const s = settle(r, people);
    expect(s.people[0]?.linesCents).toBe(4250);
    expect(s.people[0]?.taxesCents).toBe(637);
    expect(s.people[0]?.totalCents).toBe(4887);
    expect(s.receiptTotalCents).toBe(4887);
  });

  it('répartit chaque taxe au prorata de la base qui la concerne', () => {
    const r = receiptOf(
      [
        line('l1', 6000, [{ personId: 'p1' }], null),
        line('l2', 4000, [{ personId: 'p2' }], []),
      ],
      [TPS(300), TVQ(599)],
    );
    const s = settle(r, people);
    expect(s.people[0]?.taxesCents).toBe(899);
    expect(s.people[1]?.taxesCents).toBe(0);
    expect(s.people[1]?.totalCents).toBe(4000);
    expect(sumCents(s.people.map((p) => p.totalCents))).toBe(s.receiptTotalCents);
  });

  it('distingue deux taxes aux bases différentes', () => {
    const r = receiptOf(
      [
        line('livre', 3000, [{ personId: 'p1' }], ['TPS']),
        line('savon', 1000, [{ personId: 'p2' }], ['TPS', 'TVQ']),
      ],
      [TPS(200), TVQ(100)],
    );
    const s = settle(r, people);
    expect(s.people[0]?.taxesCents).toBe(150);
    expect(s.people[1]?.taxesCents).toBe(50 + 100);
    expect(sumCents(s.people.map((p) => p.taxesCents))).toBe(300);
  });

  it('signale le repli quand la base taxable est vide', () => {
    const r = receiptOf([line('l1', 1000, [{ personId: 'p1' }], [])], [TPS(50)]);
    const s = settle(r, people);
    expect(s.taxes[0]?.fellBack).toBe(true);
    expect(s.taxes[0]?.baseCents).toBe(0);
    expect(sumCents(s.people.map((p) => p.totalCents))).toBe(1050);
  });

  it('détaille la base de chaque taxe', () => {
    const r = receiptOf(
      [line('l1', 6000, [{ personId: 'p1' }]), line('l2', 4000, [{ personId: 'p2' }], [])],
      [TPS(300)],
    );
    expect(settle(r, people).taxes[0]).toMatchObject({ code: 'TPS', baseCents: 6000, fellBack: false });
  });
});

describe('settle — pourboire', () => {
  const restaurant = [
    line('plat1', 3000, [{ personId: 'p1' }]),
    line('plat2', 2000, [{ personId: 'p2' }]),
  ];

  it('se calcule sur le sous-total avant taxes', () => {
    expect(tipForPercent(receiptOf(restaurant, [TPS(250), TVQ(499)]), 'subtotal', 18)).toBe(900);
  });

  it('se calcule aussi taxes comprises quand on le demande', () => {
    expect(tipForPercent(receiptOf(restaurant, [TPS(250), TVQ(499)]), 'total', 18)).toBe(1035);
  });

  it('se répartit au prorata de ce que chacun a consommé', () => {
    const r = receiptOf(restaurant, [TPS(250), TVQ(499)], { tipCents: 900 });
    const s = settle(r, people);
    expect(s.people[0]?.tipCents).toBe(540);
    expect(s.people[1]?.tipCents).toBe(360);
    expect(sumCents(s.people.map((p) => p.tipCents))).toBe(900);
  });

  it('n’entre pas dans le total imprimé, mais bien dans le total réparti', () => {
    const r = receiptOf(restaurant, [TPS(250), TVQ(499)], { tipCents: 900 });
    const s = settle(r, people);
    expect(s.receiptTotalCents).toBe(5749);
    expect(s.distributedTotalCents).toBe(6649);
    expect(sumCents(s.people.map((p) => p.totalCents))).toBe(6649);
  });

  it('ne fait rien d’un pourboire nul', () => {
    const s = settle(receiptOf(restaurant), people);
    expect(s.tipCents).toBe(0);
    expect(s.people.every((p) => p.tipCents === 0)).toBe(true);
  });
});

describe('settle — ajustements', () => {
  it('absorbe une remise négative au prorata', () => {
    const adjustment: Adjustment = {
      id: 'a1',
      label: 'Remise',
      amountCents: -500,
      mode: 'proportional',
      assignments: [],
    };
    const r = receiptOf(
      [line('l1', 7000, [{ personId: 'p1' }]), line('l2', 3000, [{ personId: 'p2' }])],
      [],
      { adjustments: [adjustment] },
    );
    const s = settle(r, people);
    expect(s.people.map((p) => p.totalCents)).toEqual([6650, 2850, 0]);
    expect(sumCents(s.people.map((p) => p.totalCents))).toBe(9500);
  });

  it('attribue un ajustement nominatif à la seule personne visée', () => {
    const adjustment: Adjustment = {
      id: 'a1',
      label: 'Sac',
      amountCents: 12,
      mode: 'assigned',
      assignments: [{ personId: 'p2', shares: 1 }],
    };
    const r = receiptOf([line('l1', 1000, [{ personId: 'p1' }])], [], {
      adjustments: [adjustment],
    });
    const s = settle(r, people);
    expect(s.people.map((p) => p.totalCents)).toEqual([1000, 12, 0]);
  });
});

describe('settle — lignes non attribuées', () => {
  it('les partage à parts égales entre tous les participants', () => {
    const r = receiptOf([line('l1', 900, [{ personId: 'p1' }]), line('l2', 600, [])]);
    const s = settle(r, people);
    expect(s.autoSplitLineIds).toEqual(['l2']);
    expect(s.autoSplitLinesCents).toBe(600);
    expect(s.unassignedLineIds).toEqual([]);
    expect(s.unassignedLinesCents).toBe(0);
    // 900 to p1, then 600 shared three ways.
    expect(s.people.map((p) => p.totalCents)).toEqual([1100, 200, 200]);
    expect(s.distributedTotalCents).toBe(1500);
    expect(s.subtotalCents).toBe(1500);
  });

  it('marque la part partagée d’office et compte les lignes solo', () => {
    const r = receiptOf([line('l1', 900, [{ personId: 'p1' }]), line('l2', 600, [])]);
    const s = settle(r, people);
    const p1 = s.people[0] as NonNullable<(typeof s.people)[number]>;
    expect(p1.soloLineCount).toBe(1);
    expect(p1.sharedLineCount).toBe(1);
    expect(p1.items.map((item) => [item.id, item.shareCount, item.auto])).toEqual([
      ['l1', 1, false],
      ['l2', 3, true],
    ]);
  });

  it('laisse la ligne hors répartition quand il n’y a aucun participant', () => {
    const r = receiptOf([line('l1', 500, [])]);
    const s = settle(r, []);
    expect(s.unassignedLineIds).toEqual(['l1']);
    expect(s.unassignedLinesCents).toBe(500);
    expect(s.autoSplitLineIds).toEqual([]);
    expect(s.distributedTotalCents).toBe(0);
  });
});

describe('settle — 50 tickets aléatoires', () => {
  it('Σ montants dus === sous-total + taxes + ajustements + pourboire', () => {
    let seed = 987654321;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let ticket = 0; ticket < 50; ticket += 1) {
      const crowd: Person[] = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => ({
        id: `p${i}`,
        name: `Personne ${i}`,
      }));
      const lines: ReceiptLine[] = [];
      const lineCount = 1 + Math.floor(rand() * 25);
      for (let i = 0; i < lineCount; i += 1) {
        const shareCount = 1 + Math.floor(rand() * crowd.length);
        const picked = [...crowd].sort(() => rand() - 0.5).slice(0, shareCount);
        const roll = rand();
        const taxCodes = roll < 0.33 ? [] : roll < 0.5 ? ['TPS'] : null;
        lines.push(
          line(
            `l${i}`,
            1 + Math.floor(rand() * 5000),
            picked.map((p) => ({ personId: p.id, shares: 1 + Math.floor(rand() * 9) })),
            taxCodes,
          ),
        );
      }

      const taxes: ReceiptTax[] = [TPS(Math.floor(rand() * 500)), TVQ(Math.floor(rand() * 900))];
      const adjustments: Adjustment[] = [];
      if (rand() > 0.6) {
        adjustments.push({
          id: 'a0',
          label: 'Ajustement',
          amountCents: Math.floor(rand() * 800) - 400,
          mode: rand() > 0.4 ? 'proportional' : 'assigned',
          assignments: [{ personId: crowd[0]?.id as string, shares: 1 }],
        });
      }
      const tipCents = rand() > 0.5 ? Math.floor(rand() * 2000) : 0;

      const s = settle(
        {
          lines,
          taxes,
          adjustments,
          statedTotalCents: null,
          tipCents,
          tipBasis: rand() > 0.5 ? 'subtotal' : 'total',
        },
        crowd,
      );

      expect(s.unassignedLineIds).toHaveLength(0);
      expect(sumCents(s.people.map((p) => p.totalCents))).toBe(s.distributedTotalCents);
      expect(s.distributedTotalCents).toBe(s.receiptTotalCents + s.tipCents);
      expect(sumCents(s.people.map((p) => p.taxesCents))).toBe(s.taxesTotalCents);
      expect(sumCents(s.people.map((p) => p.tipCents))).toBe(s.tipCents);
    }
  });
});
