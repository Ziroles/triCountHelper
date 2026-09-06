import { describe, expect, it, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import App from '../App';
import { reset, seedGroup, seedImage, seedReceipt } from '../test/fakeApi';
import { resetForTests, useAppStore } from '../store/useAppStore';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS, type ReceiptLine } from '../types';
import { forgetEverything } from '../db';

function lineOf(id: string): ReceiptLine {
  return {
    id,
    label: 'Café',
    quantity: 1,
    unitPriceCents: 300,
    totalCents: 300,
    taxCodes: null,
    assignments: [],
    confidence: 100,
    isManual: false,
  };
}

describe('photo d’un ticket rouvert', () => {
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
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:ticket'),
      revokeObjectURL: vi.fn(),
    });
  });

  async function openStoredReceipt() {
    const receipt = seedReceipt('tTEST123456', {
      merchant: 'Chez Victoire',
      step: 'verify',
      imageId: 'img-1',
      lines: [lineOf('l1')],
    });
    seedImage(receipt.id, new Blob(['photo'], { type: 'image/jpeg' }));

    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByText('Chez Victoire'));
    await screen.findByRole('heading', { name: 'Vérification' });
    return user;
  }

  it('affiche la photo enregistrée en revenant sur l’écran de capture', async () => {
    const user = await openStoredReceipt();

    await user.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByRole('heading', { name: 'Photo du ticket' });

    expect(await screen.findByAltText(/ticket/i)).toHaveAttribute('src', 'blob:ticket');
    expect(screen.queryByText(/Déposez une photo ici/)).not.toBeInTheDocument();
  });

  it('rouvre le ticket sur sa photo, sans relancer la lecture', async () => {
    const user = await openStoredReceipt();

    // Le pas en arrière fige l’étape « capture » sur le ticket.
    await user.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByRole('heading', { name: 'Photo du ticket' });
    await user.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByRole('button', { name: 'Nouveau ticket' });

    await user.click(await screen.findByText('Chez Victoire'));
    await screen.findByRole('heading', { name: 'Photo du ticket' });
    expect(await screen.findByAltText(/ticket/i)).toHaveAttribute('src', 'blob:ticket');

    await user.click(screen.getByRole('button', { name: 'Garder la lecture actuelle' }));
    await screen.findByRole('heading', { name: 'Vérification' });
    expect(screen.getByDisplayValue('Chez Victoire')).toBeInTheDocument();
  });
});
