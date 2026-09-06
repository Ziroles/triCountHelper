import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => import('../test/fakeApi'));

import { reset, seedGroup, seedReceipt, state } from '../test/fakeApi';
import { resetForTests, useAppStore } from './useAppStore';
import { forgetEverything } from '../db';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS } from '../types';

/**
 * Comportement d'écriture du store.
 *
 * Trois propriétés qui ne se voient pas à l'œil nu, et qui portent sur de
 * l'argent : les frappes ne se perdent pas pendant un enregistrement, un
 * conflit ne se résout pas tout seul, et hors ligne on refuse d'écrire plutôt
 * que de faire semblant.
 */
describe('enregistrement d’un ticket', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    await forgetEverything();
    seedGroup('Colocation', [{ uuid: 'm-1', displayName: 'Mathieu' }]);
    useAppStore.setState({
      ready: true,
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

  async function open(partial = {}) {
    const seeded = seedReceipt('tTEST123456', partial);
    await useAppStore.getState().openReceipt(seeded.id);
    return seeded.id;
  }

  it('publie les modifications et adopte la version rendue par le serveur', async () => {
    const id = await open({ merchant: null });

    useAppStore.getState().updateReceipt({ merchant: 'IGA' });
    await useAppStore.getState().saveNow();

    expect(state.receipts.get(id)?.merchant).toBe('IGA');
    expect(useAppStore.getState().receipt?.version).toBe(2);
    expect(useAppStore.getState().saveState).toBe('idle');
  });

  it('ne perd pas une frappe survenue pendant l’enregistrement', async () => {
    const id = await open({ merchant: null });

    useAppStore.getState().updateReceipt({ merchant: 'IG' });
    const flight = useAppStore.getState().saveNow();
    // L'utilisateur continue de taper : la requête est déjà partie.
    useAppStore.getState().updateReceipt({ merchant: 'IGA EXTRA' });
    await flight;
    // La requête différée repart avec la version fraîche, sans conflit.
    await useAppStore.getState().saveNow();

    expect(useAppStore.getState().receipt?.merchant).toBe('IGA EXTRA');
    expect(state.receipts.get(id)?.merchant).toBe('IGA EXTRA');
    expect(useAppStore.getState().saveState).toBe('idle');
  });

  it('signale un conflit sans écraser le travail de l’autre', async () => {
    const id = await open({ merchant: 'Origine' });

    // Quelqu'un d'autre écrit pendant qu'on édite.
    const stored = state.receipts.get(id)!;
    state.receipts.set(id, { ...stored, merchant: 'Écrit ailleurs', version: 2 });

    useAppStore.getState().updateReceipt({ merchant: 'Ma version' });
    await useAppStore.getState().saveNow();

    expect(useAppStore.getState().saveState).toBe('conflict');
    expect(useAppStore.getState().conflict?.merchant).toBe('Écrit ailleurs');
    // Le serveur garde la version de l'autre : rien n'a été écrasé.
    expect(state.receipts.get(id)?.merchant).toBe('Écrit ailleurs');
  });

  it('reprend la version du groupe quand on renonce à ses corrections', async () => {
    const id = await open({ merchant: 'Origine' });
    const stored = state.receipts.get(id)!;
    state.receipts.set(id, { ...stored, merchant: 'Écrit ailleurs', version: 2 });

    useAppStore.getState().updateReceipt({ merchant: 'Ma version' });
    await useAppStore.getState().saveNow();
    useAppStore.getState().keepServerVersion();

    expect(useAppStore.getState().receipt?.merchant).toBe('Écrit ailleurs');
    expect(useAppStore.getState().receipt?.version).toBe(2);
    expect(useAppStore.getState().conflict).toBeNull();
    expect(useAppStore.getState().saveState).toBe('idle');
  });

  it('hors ligne, refuse d’écrire au lieu de faire semblant', async () => {
    const id = await open({ merchant: 'Origine' });
    state.offline = true;

    useAppStore.getState().updateReceipt({ merchant: 'Tapé dans le métro' });
    await useAppStore.getState().saveNow();

    expect(useAppStore.getState().saveState).toBe('offline');
    expect(state.receipts.get(id)?.merchant).toBe('Origine');
    // La saisie reste à l'écran : elle repartira au retour du réseau.
    expect(useAppStore.getState().receipt?.merchant).toBe('Tapé dans le métro');
  });

  it('hors ligne, la liste des groupes tient sur le cache', async () => {
    await useAppStore.getState().refreshGroups();
    expect(useAppStore.getState().groups).toHaveLength(1);

    state.offline = true;
    await useAppStore.getState().refreshGroups();

    expect(useAppStore.getState().groups).toHaveLength(1);
    // Une coupure réseau n'est pas une erreur à afficher : c'est un état.
    expect(useAppStore.getState().loadError).toBeNull();
  });
});

/**
 * Compatibilité des versions.
 *
 * L'API et la PWA se déploient séparément. Une divergence silencieuse se
 * manifesterait par des échecs inexplicables, tard, chez l'utilisateur.
 */
describe('contrat entre l’application et le serveur', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    await forgetEverything();
    useAppStore.setState({ ready: false, groups: [], contractMismatch: false });
  });

  it('ne signale rien quand les versions concordent', async () => {
    await useAppStore.getState().init();
    expect(useAppStore.getState().contractMismatch).toBe(false);
  });

  it('signale une divergence de version', async () => {
    state.contractVersion = '2';
    await useAppStore.getState().init();
    await vi.waitFor(() => expect(useAppStore.getState().contractMismatch).toBe(true));
  });

  it('ne confond pas une panne réseau avec une divergence', async () => {
    state.offline = true;
    await useAppStore.getState().init();
    expect(useAppStore.getState().contractMismatch).toBe(false);
  });
});
