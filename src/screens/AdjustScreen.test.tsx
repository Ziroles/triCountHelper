import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import App from '../App';
import { reset, seedGroup, seedReceipt, state } from '../test/fakeApi';
import { resetForTests, useAppStore } from '../store/useAppStore';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS, type Assignment, type ReceiptLine } from '../types';
import { forgetEverything } from '../db';

function lineOf(id: string, label: string, totalCents: number, assignments: Assignment[]): ReceiptLine {
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

describe('plats et ajustements', () => {
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
    seedReceipt('tTEST123456', {
      merchant: 'Chez Victoire',
      step: 'assign',
      lines: [
        lineOf('l1', 'Tartare', 3000, [{ personId: 'm-mathieu', shares: 1 }]),
        lineOf('l2', 'Pâtes', 2000, [{ personId: 'm-lea', shares: 1 }]),
      ],
    });
  });

  async function openDishes() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByText('Chez Victoire'));
    await screen.findByText('Étape 1 sur 3');
    await screen.findByRole('button', { name: 'Léa' });
    return user;
  }

  const receipt = () => useAppStore.getState().receipt;

  it('ajoute en partage un plat déjà pris, et le retire au second toucher', async () => {
    const user = await openDishes();

    await user.click(screen.getByRole('button', { name: 'Mathieu' })); // deselect
    await user.click(screen.getByRole('button', { name: 'Léa' }));
    await user.click(screen.getByText('Tartare'));
    await waitFor(() =>
      expect(receipt()?.lines[0]?.assignments.map((a) => a.personId)).toEqual([
        'm-mathieu',
        'm-lea',
      ]),
    );
    // Live totals: Léa now has half the tartare on top of her pasta.
    expect(screen.getByRole('button', { name: 'Léa' })).toHaveAccessibleDescription('35,00');

    await user.click(screen.getByText('Tartare'));
    await waitFor(() =>
      expect(receipt()?.lines[0]?.assignments.map((a) => a.personId)).toEqual(['m-mathieu']),
    );
  });

  it('applique une remise aux seules personnes des plats choisis', async () => {
    const user = await openDishes();
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Étape 2 sur 3');

    // The adjustments step does not exist for the API: the receipt stays on "assign".
    await waitFor(() => expect(state.receipts.get(receipt()!.id)?.step).toBe('assign'));
    expect(window.location.pathname).toMatch(/\/adjust$/);

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ajouter une remise' });
    await user.type(within(sheet).getByPlaceholderText(/Rabais fidélité/), 'Rabais tartare');
    await user.type(within(sheet).getByLabelText('Montant'), '6,00');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('−6,00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sur des plats' }));
    const picker = await screen.findByRole('dialog', { name: /sur quels plats/ });
    await user.click(within(picker).getByLabelText(/Tartare/));
    await user.click(within(picker).getByRole('button', { name: 'Appliquer' }));

    await waitFor(() => {
      const adjustment = receipt()?.adjustments[0];
      expect(adjustment?.mode).toBe('assigned');
      expect(adjustment?.assignments).toEqual([{ personId: 'm-mathieu', shares: 3000 }]);
    });
    expect(screen.getByText('sur 1 plat, pour Mathieu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Étape 3 sur 3');
    const mathieu = screen.getByRole('button', { name: /^Mathieu/ }).closest('li') as HTMLElement;
    expect(within(mathieu).getByText('24,00')).toBeInTheDocument();
    expect(within(mathieu).getByText(/remise −6,00/)).toBeInTheDocument();
  });

  async function openAdjustments() {
    const user = await openDishes();
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Étape 2 sur 3');
    return user;
  }

  const tipSection = () => screen.getByRole('region', { name: 'Pourboire' });
  const taxSection = () => screen.getByRole('region', { name: 'Taxes' });

  it('fait suivre au pourboire son pourcentage quand la base change', async () => {
    const user = await openAdjustments();

    await user.click(screen.getByRole('button', { name: '18 %' }));
    await waitFor(() => expect(receipt()?.tipCents).toBe(900));

    // Computed taxes say so: they were not read on the receipt. These dishes
    // are tax-exempt, so the computed amounts are zero.
    await user.click(screen.getByRole('button', { name: '+ Québec' }));
    expect(await within(taxSection()).findByText('calculées sur le taux')).toBeInTheDocument();
    expect(receipt()?.taxes.map((tax) => tax.amountCents)).toEqual([0, 0]);

    await user.click(screen.getByRole('button', { name: 'Après taxes' }));
    await waitFor(() => expect(receipt()?.tipBasis).toBe('total'));
    expect(receipt()?.tipCents).toBe(900);

    // A tax corrected by hand: the tip follows (18 % of 50,00 + 3,00), and the
    // tax is no longer "computed".
    await user.click(screen.getByRole('button', { name: /TPS 5 %/ }));
    const sheet = await screen.findByRole('dialog', { name: 'TPS' });
    const amount = within(sheet).getByLabelText('Montant de TPS');
    await user.clear(amount);
    await user.type(amount, '3,00');
    await user.click(within(sheet).getByRole('button', { name: 'Terminé' }));

    await waitFor(() => expect(receipt()?.tipCents).toBe(954));
    expect(within(tipSection()).getByRole('button', { name: '18 %' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(taxSection()).getByText('en partie calculées')).toBeInTheDocument();

    // Removed: back to a single computed tax.
    await user.click(screen.getByRole('button', { name: /TPS 5 %/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'TPS' })).getByRole('button', {
        name: 'Retirer cette taxe',
      }),
    );
    await waitFor(() => expect(receipt()?.taxes.map((tax) => tax.code)).toEqual(['TVQ']));
    expect(within(taxSection()).getByText('calculées sur le taux')).toBeInTheDocument();
  });

  it('laisse un montant libre de pourboire tel quel', async () => {
    const user = await openAdjustments();

    await user.click(screen.getByRole('button', { name: '18 %' }));
    await user.click(screen.getByRole('button', { name: 'Autre' }));
    await user.click(screen.getByRole('button', { name: '$' }));
    const field = screen.getByLabelText('Montant du pourboire');
    await user.clear(field);
    await user.type(field, '5,00');
    await user.tab();
    await waitFor(() => expect(receipt()?.tipCents).toBe(500));

    await user.click(screen.getByRole('button', { name: 'Après taxes' }));
    await user.click(screen.getByRole('button', { name: '+ Québec' }));
    await screen.findByRole('button', { name: /TPS 5 %/ });
    expect(receipt()?.tipCents).toBe(500);
    expect(within(tipSection()).getByRole('button', { name: 'Autre' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(tipSection()).getByRole('button', { name: '$' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('accepte un taux libre qui suit la base, puis le fige en montant', async () => {
    const user = await openAdjustments();

    await user.click(screen.getByRole('button', { name: 'Autre' }));
    const rate = screen.getByLabelText('Taux du pourboire');
    await user.type(rate, '22');
    await user.tab();
    await waitFor(() => expect(receipt()?.tipCents).toBe(1100));

    // A tax corrected by hand: 22 % follows the new base (50,00 + 3,00).
    await user.click(screen.getByRole('button', { name: 'Après taxes' }));
    await user.click(screen.getByRole('button', { name: '+ Québec' }));
    await user.click(await screen.findByRole('button', { name: /TPS 5 %/ }));
    const sheet = await screen.findByRole('dialog', { name: 'TPS' });
    const amount = within(sheet).getByLabelText('Montant de TPS');
    await user.clear(amount);
    await user.type(amount, '3,00');
    await user.click(within(sheet).getByRole('button', { name: 'Terminé' }));
    await waitFor(() => expect(receipt()?.tipCents).toBe(1166));
    expect(screen.getByLabelText('Taux du pourboire')).toHaveValue('22');

    // Switched to an amount: it no longer moves.
    await user.click(screen.getByRole('button', { name: '$' }));
    expect(screen.getByLabelText('Montant du pourboire')).toHaveValue('11,66');
    await user.click(screen.getByRole('button', { name: 'Avant taxes' }));
    await waitFor(() => expect(receipt()?.tipBasis).toBe('subtotal'));
    expect(receipt()?.tipCents).toBe(1166);
  });

  it('arrondit un taux décimal au centime', async () => {
    const user = await openAdjustments();

    await user.click(screen.getByRole('button', { name: 'Autre' }));
    await user.type(screen.getByLabelText('Taux du pourboire'), '12,5');
    await user.tab();
    await waitFor(() => expect(receipt()?.tipCents).toBe(625));
  });

  it('fait suivre à une remise sur des plats les changements d’attribution', async () => {
    const user = await openAdjustments();

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ajouter une remise' });
    await user.type(within(sheet).getByLabelText('Montant'), '6,00');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    await user.click(await screen.findByRole('button', { name: 'Sur des plats' }));
    const picker = await screen.findByRole('dialog', { name: /sur quels plats/ });
    await user.click(within(picker).getByLabelText(/Tartare/));
    await user.click(within(picker).getByRole('button', { name: 'Appliquer' }));
    expect(await screen.findByText('sur 1 plat, pour Mathieu')).toBeInTheDocument();

    // The tartare changes hands at step 1.
    await user.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByText('Étape 1 sur 3');
    await user.click(screen.getByRole('button', { name: 'Mathieu' })); // deselect
    await user.click(screen.getByRole('button', { name: 'Léa' }));
    await user.click(screen.getByText('Tartare')); // Léa joins
    await user.click(screen.getByRole('button', { name: 'Mathieu' }));
    await user.click(screen.getByText('Tartare')); // Mathieu leaves

    await waitFor(() =>
      expect(receipt()?.adjustments[0]?.assignments).toEqual([{ personId: 'm-lea', shares: 3000 }]),
    );
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByText('sur 1 plat, pour Léa')).toBeInTheDocument();

    // Back to prorata: nothing assigned any more.
    await user.click(screen.getByRole('button', { name: 'Au prorata' }));
    await waitFor(() => {
      expect(receipt()?.adjustments[0]?.mode).toBe('proportional');
      expect(receipt()?.adjustments[0]?.assignments).toEqual([]);
    });
  });
  it('partage une remise sur des plats à parts égales', async () => {
    const user = await openAdjustments();

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ajouter une remise' });
    await user.type(within(sheet).getByLabelText('Montant'), '6,00');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    await user.click(await screen.findByRole('button', { name: 'Sur des plats' }));
    const picker = await screen.findByRole('dialog', { name: /sur quels plats/ });
    await user.click(within(picker).getByLabelText(/Tartare/));
    await user.click(within(picker).getByRole('button', { name: 'À parts égales' }));
    await user.click(within(picker).getByRole('button', { name: 'Appliquer' }));

    expect(await screen.findByText('sur 1 plat, à parts égales, pour Mathieu')).toBeInTheDocument();
    expect(receipt()?.adjustments[0]?.assignments.map((a) => a.shares)).toEqual([1]);
  });
});
