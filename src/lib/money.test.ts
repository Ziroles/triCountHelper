import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, formatCentsPlain, parseAmountToCents, roundHalfUp } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['12,34', 1234],
    ['12.34', 1234],
    ['1 234,56', 123456],
    ['12,34 $', 1234],
    ['12.34 €', 1234],
    ['12', 1200],
    ['12,5', 1250],
    ['0,05', 5],
    ['-3,20', -320],
    [',99', 99],
    ['+4,00', 400],
  ])('lit « %s » comme %i centimes', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(['', '-', 'abc', '12,345', '1.2.3', '12$34', '12€34'])('rejette « %s »', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it('ne passe jamais par un flottant : 0,07 × 100 reste exact', () => {
    expect(parseAmountToCents('0,07')).toBe(7);
    expect(parseAmountToCents('1,10')).toBe(110);
    expect(parseAmountToCents('29,29')).toBe(2929);
  });
});

describe('formatage', () => {
  it('rend les centimes en saisie éditable', () => {
    expect(centsToInput(4782)).toBe('47,82');
    expect(centsToInput(5)).toBe('0,05');
    expect(centsToInput(-320)).toBe('-3,20');
    expect(formatCentsPlain(0)).toBe('0,00');
  });
});

describe('roundHalfUp', () => {
  it('arrondit symétriquement', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(2.4)).toBe(2);
  });
});

describe('formatCents', () => {
  it('rend des dollars canadiens', () => {
    const normalized = (cents: number) => formatCents(cents).replace(/[\s  ]/g, ' ');
    expect(normalized(4782)).toBe('47,82 $');
    expect(normalized(0)).toBe('0,00 $');
    expect(normalized(-250)).toBe('-2,50 $');
  });
});

describe('formatAmount', () => {
  it('écrit les montants à la française, avec un vrai signe moins', async () => {
    const { formatAmount, formatMoney } = await import('./money');
    expect(formatAmount(6039)).toBe('60,39');
    expect(formatAmount(-1000)).toBe('−10,00');
    expect(formatAmount(123456).replace(/\s/g, ' ')).toBe('1 234,56');
    expect(formatMoney(23803)).toBe('238,03 $');
  });
});
