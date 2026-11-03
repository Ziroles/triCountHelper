import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import App from '../App';
import { reset, seedGroup, seedReceipt, state } from '../test/fakeApi';
import { resetForTests, useAppStore } from '../store/useAppStore';
import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_SETTINGS,
  type Receipt,
  type ReceiptLine,
} from '../types';
import { forgetEverything } from '../db';

function lineOf(id: string, label: string, totalCents: number): ReceiptLine {
  return {
    id,
    label,
    quantity: 1,
    unitPriceCents: totalCents,
    totalCents,
    taxCodes: [],
    assignments: [],
    confidence: 100,
    isManual: false,
  };
}

/** The journey between steps: where "back" and "continue" lead. */
describe('parcours d’un ticket', () => {
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

  async function open(partial: Partial<Receipt>) {
    seedReceipt('tTEST123456', { merchant: 'Chez Victoire', ...partial });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByText('Chez Victoire'));
    return user;
  }

  it('revient à l’étape d’origine après la correction des lignes', async () => {
    const user = await open({
      step: 'assign',
      lines: [lineOf('l1', 'Tartare', 3000)],
      statedTotalCents: 2000,
    });
    await screen.findByText('Étape 1 sur 3');

    // From the dishes, through the menu: back returns to the dishes.
    await user.click(screen.getByRole('button', { name: 'Plus d’actions' }));
    await user.click(screen.getByRole('button', { name: 'Corriger les lignes du ticket' }));
    await screen.findByRole('heading', { name: 'Vérification' });
    await user.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByText('Étape 1 sur 3');

    // From the adjustments, through the gap: continue returns to the adjustments.
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Étape 2 sur 3');
    await user.click(screen.getByRole('button', { name: 'Corriger les lignes' }));
    await screen.findByRole('heading', { name: 'Vérification' });
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Étape 2 sur 3');
  });

  it('quitte le ticket au retour depuis les plats, sans rouvrir la photo', async () => {
    const user = await open({
      step: 'assign',
      imageId: 'img-1',
      lines: [lineOf('l1', 'Tartare', 3000)],
    });
    await screen.findByText('Étape 1 sur 3');

    await user.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByRole('button', { name: 'Nouveau ticket' });
  });

  it('ne laisse pas continuer sans aucun plat', async () => {
    const user = await open({ step: 'assign', lines: [] });
    await screen.findByText('Étape 1 sur 3');

    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Saisir les lignes du ticket' }));
    await screen.findByRole('heading', { name: 'Vérification' });
  });

  it('envoie vers la saisie quand la lecture ne trouve aucune ligne', async () => {
    state.scanResult = { lines: [] };
    await open({ step: 'processing', imageId: 'img-1', lines: [] });

    await screen.findByRole('heading', { name: 'Vérification' });
    expect(screen.getByText(/La lecture n’a trouvé aucune ligne/)).toBeInTheDocument();
  });

  it('charge le groupe quand le ticket est ouvert directement par son adresse', async () => {
    const receipt = seedReceipt('tTEST123456', {
      merchant: 'Chez Victoire',
      step: 'assign',
      lines: [lineOf('l1', 'Tartare', 3000)],
    });
    window.history.replaceState(null, '', `/g/tTEST123456/t/${receipt.id}/assign`);
    render(<App />);

    await screen.findByText('Étape 1 sur 3');
    expect(await screen.findByRole('button', { name: 'Léa' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/^Colocation, /)).toBeInTheDocument());
  });
});
