import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import App from '../App';
import { reset, seedGroup, seedReceipt } from '../test/fakeApi';
import { resetForTests, useAppStore } from '../store/useAppStore';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS } from '../types';
import { forgetEverything } from '../db';

/**
 * A line's cents, through the interface.
 *
 * These cases describe a concrete trap: 3 beers at $10.00 show as 3 × 3.33, and
 * starting again from that rounded unit price would drop the line to $9.99.
 * What is checked here is that no round trip through a field loses a cent.
 */
describe('centimes d’une ligne', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    await forgetEverything();
    seedGroup('Colocation', [{ uuid: 'm-1', displayName: 'Mathieu' }]);
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

  async function openLine() {
    seedReceipt('tTEST123456', {
      merchant: 'Chez Victoire',
      step: 'verify',
      statedTotalCents: 1000,
      lines: [
        {
          id: 'l1',
          label: 'Bière',
          quantity: 3,
          unitPriceCents: 333,
          totalCents: 1000,
          taxCodes: [],
          assignments: [],
          confidence: 100,
          isManual: false,
        },
      ],
    });

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByText('Chez Victoire'));
    await screen.findByRole('heading', { name: 'Vérification' });
    return user;
  }

  const line = () => useAppStore.getState().receipt?.lines[0];

  it('ne perd pas un centime quand on traverse le champ sans rien changer', async () => {
    const user = await openLine();

    await user.click(screen.getByLabelText('Prix unitaire'));
    await user.tab();
    expect(line()?.totalCents).toBe(1000);

    await user.click(screen.getByLabelText('Total de la ligne'));
    await user.tab();
    expect(line()?.totalCents).toBe(1000);
  });

  it('ne perd pas un centime quand on vide le champ quantité pour retaper le même chiffre', async () => {
    const user = await openLine();
    const quantity = screen.getByLabelText('Quantité');

    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.tab();

    expect(line()?.quantity).toBe(3);
    expect(line()?.totalCents).toBe(1000);
  });

  it('met le total à l’échelle de la quantité, sans dérive d’arrondi', async () => {
    const user = await openLine();
    const quantity = screen.getByLabelText('Quantité');

    await user.clear(quantity);
    await user.type(quantity, '6');
    await user.tab();

    // 6 × 3.33 would give $19.98: it is the real total that gets doubled.
    expect(line()?.totalCents).toBe(2000);
  });

  it('laisse le prix unitaire saisi commander le total', async () => {
    const user = await openLine();
    const unit = screen.getByLabelText('Prix unitaire');

    await user.clear(unit);
    await user.type(unit, '4,00');
    await user.tab();

    expect(line()?.unitPriceCents).toBe(400);
    expect(line()?.totalCents).toBe(1200);
  });
});
