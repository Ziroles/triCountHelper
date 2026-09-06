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
 * Parcours complet, du groupe au récapitulatif copiable.
 *
 * Ces scénarios sont ceux de la version locale, transposés : les participants
 * ne sont plus saisis à la main mais viennent du tricount. Les montants
 * attendus, eux, n'ont pas bougé d'un centime — c'est précisément ce qu'ils
 * vérifient.
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

    // Les participants sont déjà là : ils viennent du tricount, et le premier
    // est présélectionné pour que l'écran soit utilisable sans geste préalable.
    await screen.findByRole('button', { name: 'Léa' });
    await user.click(screen.getByText('Tartare')); // → Mathieu, présélectionné
    await user.click(screen.getByRole('button', { name: 'Mathieu' })); // on le retire
    await user.click(screen.getByRole('button', { name: 'Léa' })); // on prend Léa
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
    await user.click(screen.getByText('Bière')); // → Mathieu, présélectionné
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
    // Un autre appareil : ni cache local, ni état en mémoire, ni adresse
    // héritée. Tout ce qui s'affichera devra donc venir du serveur.
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
 * Historique du navigateur.
 *
 * En PWA installée, le geste retour du système est la seule façon de reculer.
 * Sans entrée d'historique, il quitte l'application — et le parcours compte
 * désormais trois niveaux.
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
