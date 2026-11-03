import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import App from '../App';
import { reset, state } from '../test/fakeApi';
import { resetForTests, useAppStore } from '../store/useAppStore';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_SETTINGS } from '../types';
import { forgetEverything } from '../db';
import {
  knownAccountEmail,
  rememberAccountEmail,
  requestPersistentStorage,
  resetSessionForTests,
} from '../lib/session';

/**
 * A session lost to cleared storage: the device enrols again as anonymous.
 * The app must say so and offer to sign back in, not carry on silently.
 */
describe('rester connecté', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    resetSessionForTests();
    await forgetEverything();
    useAppStore.setState({
      ready: false,
      groups: [],
      group: null,
      settings: DEFAULT_SETTINGS,
      server: DEFAULT_SERVER_SETTINGS,
      route: { name: 'groups' },
      online: true,
      accountEmail: null,
      lostAccountEmail: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retient l’adresse du compte une fois connecté', async () => {
    state.accountEmail = 'lea@exemple.ca';
    render(<App />);
    await waitFor(() => expect(knownAccountEmail()).toBe('lea@exemple.ca'));
    expect(screen.queryByText('Reconnectez-vous.')).not.toBeInTheDocument();
  });

  it('propose de se reconnecter quand la session est perdue, adresse préremplie', async () => {
    const user = userEvent.setup();
    rememberAccountEmail('lea@exemple.ca');
    render(<App />);

    expect(await screen.findByText('Reconnectez-vous.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Se reconnecter' }));

    expect(await screen.findByLabelText('Adresse courriel')).toHaveValue('lea@exemple.ca');
    await user.type(screen.getByLabelText('Mot de passe'), 'motdepasse');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(useAppStore.getState().accountEmail).toBe('lea@exemple.ca'));
    expect(useAppStore.getState().lostAccountEmail).toBeNull();
  });

  it('« Continuer sans compte » ne redemande plus', async () => {
    const user = userEvent.setup();
    rememberAccountEmail('lea@exemple.ca');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Continuer sans compte' }));
    expect(screen.queryByText('Reconnectez-vous.')).not.toBeInTheDocument();
    expect(knownAccountEmail()).toBeNull();
  });

  it('demande un stockage persistant une seule fois, et survit à un refus', async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist, persisted: async () => false } });

    expect(await requestPersistentStorage()).toBe(false);
    expect(await requestPersistentStorage()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
