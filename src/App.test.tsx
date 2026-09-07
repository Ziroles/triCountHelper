import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api', () => import('./test/fakeApi'));

import App from './App';
import { reset, seedGroup, state } from './test/fakeApi';
import { resetForTests, useAppStore } from './store/useAppStore';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS } from './types';
import { clearCache, forgetEverything } from './db';

/**
 * Full journey, from the group to the copyable summary.
 *
 * These scenarios are the local version's, transposed: the participants are no
 * longer typed in by hand but come from the tricount. The expected amounts, for
 * their part, have not moved by a cent — which is precisely what they check.
 */
describe('parcours complet, sans photo', () => {
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
      saveError: null,
      conflict: null,
    });
  });

  async function startManualReceipt(user: ReturnType<typeof userEvent.setup>) {
    render(<App />);
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByRole('button', { name: 'Nouveau ticket' }));
    await user.click(await screen.findByRole('button', { name: 'Saisir le ticket à la main' }));
    await screen.findByRole('heading', { name: 'Vérification' });
  }

  async function fillAmount(
    user: ReturnType<typeof userEvent.setup>,
    field: HTMLElement,
    value: string,
  ) {
    await user.clear(field);
    await user.type(field, value);
  }

  it('mène d’un souper à deux jusqu’au récapitulatif copiable', async () => {
    const user = userEvent.setup();
    await startManualReceipt(user);

    await user.type(screen.getByPlaceholderText('Carrefour, boulangerie…'), 'Chez Victoire');

    const addLine = screen.getByRole('button', { name: '+ Ajouter une ligne' });
    await user.click(addLine);
    await user.click(addLine);

    const labels = screen.getAllByLabelText('Libellé de la ligne');
    await user.type(labels[0] as HTMLElement, 'Tartare');
    await user.type(labels[1] as HTMLElement, 'Pâtes');

    const totals = screen.getAllByLabelText('Total de la ligne');
    await fillAmount(user, totals[0] as HTMLElement, '30,00');
    await fillAmount(user, totals[1] as HTMLElement, '20,00');

    await user.click(screen.getByRole('button', { name: '+ Québec' }));
    await fillAmount(user, await screen.findByLabelText('Montant de TPS'), '2,50');
    await fillAmount(user, screen.getByLabelText('Montant de TVQ'), '4,99');

    await user.type(screen.getByLabelText('Total lu sur le ticket'), '57,49');

    await waitFor(() => {
      const banner = screen.getByRole('group', { name: 'Contrôle du total' });
      expect(banner).toHaveTextContent('50,00');
      expect(banner).toHaveTextContent('7,49');
      expect(banner).toHaveTextContent('✓');
    });

    await user.click(screen.getByRole('button', { name: 'Attribuer' }));
    await screen.findByRole('heading', { name: 'Attribution' });

    // The participants are already there: they come from the tricount, and the
    // first is preselected so the screen is usable without a prior gesture.
    await screen.findByRole('button', { name: 'Léa' });
    await user.click(screen.getByText('Tartare')); // → Mathieu, preselected
    await user.click(screen.getByRole('button', { name: 'Mathieu' })); // remove them
    await user.click(screen.getByRole('button', { name: 'Léa' })); // pick Léa
    await user.click(screen.getByText('Pâtes')); // → Léa

    await waitFor(() => expect(screen.queryByText(/non attribuée/)).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Voir les résultats' }));

    await screen.findByRole('heading', { name: 'Résultats' });
    const mathieu = () =>
      screen.getByRole('button', { name: 'Mathieu' }).closest('li') as HTMLElement;
    expect(within(mathieu()).getByText('34,49 $')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '18 %' }));
    await waitFor(() => expect(within(mathieu()).getByText('39,89 $')).toBeInTheDocument());
    expect(within(mathieu()).getByText(/pourboire/)).toHaveTextContent('5,40');

    const total = screen.getByText('Total').closest('div') as HTMLElement;
    expect(within(total).getByText('66,49 $')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copier le récapitulatif' }));
    await waitFor(async () => {
      const copied = await navigator.clipboard.readText();
      expect(copied).toContain('Sous-total : 50,00 $ · taxes : 7,49 $');
      expect(copied).toContain('Pourboire : 9,00 $');
      expect(copied).toContain('Total : 66,49 $');
      expect(copied).toContain('Mathieu : 39,89 $');
      expect(copied).toContain('Léa : 26,60 $');
    });
  });

  it('ne fait pas payer la taxe à qui n’a acheté que du détaxé', async () => {
    const user = userEvent.setup();
    await startManualReceipt(user);

    const addLine = screen.getByRole('button', { name: '+ Ajouter une ligne' });
    await user.click(addLine);
    await user.click(addLine);

    const labels = screen.getAllByLabelText('Libellé de la ligne');
    await user.type(labels[0] as HTMLElement, 'Bière');
    await user.type(labels[1] as HTMLElement, 'Pain');

    const totals = screen.getAllByLabelText('Total de la ligne');
    await fillAmount(user, totals[0] as HTMLElement, '60,00');
    await fillAmount(user, totals[1] as HTMLElement, '40,00');

    await user.click(screen.getByLabelText('Pain : soumise aux taxes'));

    await user.click(screen.getByRole('button', { name: '+ Québec' }));
    await fillAmount(user, await screen.findByLabelText('Montant de TPS'), '3,00');
    await fillAmount(user, screen.getByLabelText('Montant de TVQ'), '5,99');

    await user.click(screen.getByRole('button', { name: 'Attribuer' }));
    await screen.findByRole('heading', { name: 'Attribution' });

    await screen.findByRole('button', { name: 'Léa' });
    await user.click(screen.getByText('Bière')); // → Mathieu, preselected
    await user.click(screen.getByRole('button', { name: 'Mathieu' }));
    await user.click(screen.getByRole('button', { name: 'Léa' }));
    await user.click(screen.getByText('Pain')); // → Léa

    await user.click(screen.getByRole('button', { name: 'Voir les résultats' }));
    await screen.findByRole('heading', { name: 'Résultats' });

    const lea = screen.getByRole('button', { name: 'Léa' }).closest('li') as HTMLElement;
    expect(within(lea).getByText('40,00 $')).toBeInTheDocument();
    expect(within(lea).getByText(/dont taxes/)).toHaveTextContent('0,00');

    const mathieu = screen.getByRole('button', { name: 'Mathieu' }).closest('li') as HTMLElement;
    expect(within(mathieu).getByText('68,99 $')).toBeInTheDocument();
  });

  it('signale l’écart avec le total du ticket, et sait l’absorber', async () => {
    const user = userEvent.setup();
    await startManualReceipt(user);

    await user.click(screen.getByRole('button', { name: '+ Ajouter une ligne' }));
    await fillAmount(user, screen.getByLabelText('Total de la ligne'), '10,00');
    await user.type(screen.getByLabelText('Total lu sur le ticket'), '8,80');

    const gap = await screen.findByText(/Écart de/);
    expect(gap).toHaveTextContent('1,20');
    await user.click(screen.getByRole('button', { name: 'Ajouter en ajustement' }));

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Contrôle du total' })).toHaveTextContent('✓'),
    );
    expect(screen.getByText('Écart de saisie')).toBeInTheDocument();
  });

  it('reprend un ticket là où il avait été laissé, depuis le serveur', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByRole('button', { name: 'Nouveau ticket' }));
    await user.click(await screen.findByRole('button', { name: 'Saisir le ticket à la main' }));
    await screen.findByRole('heading', { name: 'Vérification' });
    await user.type(screen.getByPlaceholderText('Carrefour, boulangerie…'), 'Boulangerie');
    await user.click(screen.getByRole('button', { name: '+ Ajouter une ligne' }));

    await waitFor(() => {
      const stored = [...state.receipts.values()][0];
      expect(stored?.merchant).toBe('Boulangerie');
      expect(stored?.lines).toHaveLength(1);
    });

    unmount();
    // Another device: no local cache, no in-memory state, no inherited
    // address. So everything shown will have to come from the server.
    await clearCache();
    resetForTests();
    window.history.replaceState(null, '', '/');
    useAppStore.setState({
      ready: false,
      groups: [],
      group: null,
      receipts: [],
      receipt: null,
      route: { name: 'groups' },
    });

    render(<App />);
    await user.click(await screen.findByText('Colocation'));
    await user.click(await screen.findByText('Boulangerie'));
    await screen.findByRole('heading', { name: 'Vérification' });
    expect(screen.getAllByLabelText('Libellé de la ligne')).toHaveLength(1);
  });
});

/**
 * Browser history.
 *
 * In an installed PWA, the system's back gesture is the only way to step back.
 * Without a history entry, it leaves the application — and the journey now has
 * three levels.
 */
describe('geste retour et adresses', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    await forgetEverything();
    seedGroup('Colocation', [{ uuid: 'm-1', displayName: 'Mathieu' }]);
    window.history.replaceState(null, '', '/');
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

  it('empile une adresse par écran', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Réglages' }));
    await waitFor(() => expect(window.location.pathname).toBe('/reglages'));

    window.history.back();
    await screen.findByText('Colocation');

    await user.click(screen.getByText('Colocation'));
    await waitFor(() => expect(window.location.pathname).toBe('/g/tTEST123456'));
  });

  it('recule d’un écran au lieu de quitter l’application', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText('Colocation'));
    await screen.findByRole('heading', { name: 'Colocation' });

    window.history.back();

    await waitFor(() => expect(useAppStore.getState().route.name).toBe('groups'));
    await screen.findByRole('button', { name: 'Rejoindre un groupe' });
  });

  it('ouvre directement l’écran désigné par l’adresse', async () => {
    window.history.replaceState(null, '', '/reglages');
    render(<App />);

    await screen.findByRole('heading', { name: 'Réglages' });
    expect(useAppStore.getState().route).toEqual({ name: 'settings' });
  });

  it('retombe sur l’accueil pour une adresse inconnue', async () => {
    window.history.replaceState(null, '', '/nimporte/quoi');
    render(<App />);

    await screen.findByRole('button', { name: 'Rejoindre un groupe' });
    expect(useAppStore.getState().route).toEqual({ name: 'groups' });
  });
});
