import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import App from '../App';
import { reset, seedGroup, seedReceipt, state } from '../test/fakeApi';
import { resetForTests, useAppStore } from '../store/useAppStore';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS, type Assignment, type ReceiptLine } from '../types';
import { forgetEverything } from '../db';

function lineOf(
  id: string,
  label: string,
  totalCents: number,
  assignments: Assignment[],
): ReceiptLine {
  return {
    id,
    label,
    quantity: 1,
    unitPriceCents: totalCents,
    totalCents,
    taxCodes: [],
    assignments,
    confidence: 100,
    isManual: false,
  };
}

describe('résultats', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    await forgetEverything();
    seedGroup('Colocation', [
      { uuid: 'm-mathieu', displayName: 'Mathieu' },
      { uuid: 'm-lea', displayName: 'Léa' },
    ]);
    useAppStore.setState({
      ready: false,
      groups: [],
      group: null,
      receipts: [],
      receipt: null,
      settings: DEFAULT_SETTINGS,
      server: DEFAULT_SERVER_SETTINGS,
      route: { name: 'groups' },
      online: true,
      saveState: 'idle',
      conflict: null,
    });
  });

  async function openResults() {
    seedReceipt('tTEST123456', {
      merchant: 'Chez Victoire',
      step: 'results',
      lines: [
        lineOf('l1', 'Tartare', 3000, [{ personId: 'm-mathieu', shares: 1 }]),
        lineOf('l2', 'Vin', 2000, [
          { personId: 'm-mathieu', shares: 1 },
          { personId: 'm-lea', shares: 1 },
        ]),
        // Nobody claimed the bread: it goes to everyone.
        lineOf('l3', 'Pain', 400, []),
      ],
    });

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByText('Chez Victoire'));
    await screen.findByRole('heading', { name: 'Résultats' });
    return user;
  }

  it('répartit d’office la ligne que personne n’a prise', async () => {
    await openResults();

    // 3000 + 1000 + 200 for Mathieu, 1000 + 200 for Léa: nothing is lost.
    expect(screen.getByText(/^42,00/)).toBeInTheDocument();
    expect(screen.getByText(/^12,00/)).toBeInTheDocument();
    expect(screen.getByText(/1 ligne non attribuée/).textContent).toMatch(
      /1 ligne non attribuée — 4,00.+partagé entre les 2 participants/,
    );
  });

  it('distingue à l’icône ce qui est payé seul de ce qui est partagé', async () => {
    const user = await openResults();

    const mathieu = screen.getByRole('button', { name: 'Mathieu' }).closest('li') as HTMLElement;
    expect(within(mathieu).getByText(/1 seul$/)).toBeInTheDocument();
    expect(within(mathieu).getByText(/2 partagés$/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mathieu' }));

    expect(within(mathieu).getByTitle('Payé seul')).toBeInTheDocument();
    expect(within(mathieu).getByTitle('Partagé à 2')).toBeInTheDocument();
    expect(within(mathieu).getByTitle('Partagé à 2 — réparti par défaut')).toBeInTheDocument();
  });

  it('envoie la dépense vers Tricount avec les uuid des membres, pas leurs noms', async () => {
    const user = await openResults();

    await user.click(screen.getByRole('button', { name: 'Envoyer vers Tricount' }));
    await screen.findByText('Dépense envoyée. Elle apparaît dans Tricount.');

    const sent = state.pushed[0]?.payload as {
      payerMemberUuid: string;
      totalCents: number;
      shares: { memberUuid: string; amountCents: number }[];
    };
    expect(sent.payerMemberUuid).toBe('m-mathieu');
    expect(sent.shares).toEqual([
      { memberUuid: 'm-mathieu', amountCents: 4200 },
      { memberUuid: 'm-lea', amountCents: 1200 },
    ]);
    // The server's guard rail: the shares must add up to the total.
    expect(sent.shares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(sent.totalCents);
  });
});
