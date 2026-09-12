import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => import('../test/fakeApi'));

import { reset, state } from '../test/fakeApi';
import { resetForTests, useAppStore } from './useAppStore';
import * as db from '../db';
import { newDeviceKek, open } from '../lib/crypto';
import { DEFAULT_SERVER_SETTINGS } from '../types';

/**
 * Where the user's Gemini key lives.
 *
 * Without an account it stays on this device, sealed. With one it goes to the
 * server, sealed with the account's KEK. And a key saved before the account
 * existed follows it, rather than asking to be typed in again.
 */
describe('clé Gemini de l’utilisateur', () => {
  beforeEach(async () => {
    reset();
    resetForTests();
    await db.forgetEverything();
    useAppStore.setState({
      server: DEFAULT_SERVER_SETTINGS,
      geminiKey: null,
      accountEmail: null,
      online: true,
    });
  });

  async function becomeAccount(): Promise<CryptoKey> {
    // What `createAccount` does on the real client: derive a KEK and keep it.
    const kek = await newDeviceKek();
    await db.setKek(kek);
    state.accountEmail = 'moi@example.com';
    return kek;
  }

  it('sans compte, se garde chiffrée sur l’appareil sans rien envoyer au serveur', async () => {
    await useAppStore.getState().updateServerSettings({ geminiKey: 'AIza-cle-locale' });

    expect(useAppStore.getState().geminiKey).toBe('AIza-cle-locale');
    expect(state.settings.geminiKeyBlob).toBeNull();
    const blob = await db.getLocalKeyBlob();
    expect(blob).not.toBeNull();
    expect(blob).not.toContain('AIza-cle-locale');
  });

  it('sans compte, se rouvre sans être ressaisie', async () => {
    await useAppStore.getState().updateServerSettings({ geminiKey: 'AIza-cle-locale' });
    useAppStore.setState({ geminiKey: null });

    await useAppStore.getState().refreshMe();

    expect(useAppStore.getState().geminiKey).toBe('AIza-cle-locale');
  });

  it('suit le compte dès qu’il existe, et quitte l’appareil', async () => {
    await useAppStore.getState().updateServerSettings({ geminiKey: 'AIza-cle-locale' });
    const accountKek = await becomeAccount();

    await useAppStore.getState().refreshMe();

    const blob = state.settings.geminiKeyBlob;
    expect(blob).not.toBeNull();
    expect(await open(accountKek, blob!)).toBe('AIza-cle-locale');
    expect(await db.getLocalKeyBlob()).toBeNull();
    expect(useAppStore.getState().geminiKey).toBe('AIza-cle-locale');
  });

  it('avec un compte, part chiffrée sur le serveur', async () => {
    const accountKek = await becomeAccount();
    useAppStore.setState({ accountEmail: 'moi@example.com' });

    await useAppStore.getState().updateServerSettings({ geminiKey: 'AIza-cle-compte' });

    expect(await open(accountKek, state.settings.geminiKeyBlob!)).toBe('AIza-cle-compte');
    expect(await db.getLocalKeyBlob()).toBeNull();
  });

  it('s’efface', async () => {
    await useAppStore.getState().updateServerSettings({ geminiKey: 'AIza-cle-locale' });

    await useAppStore.getState().updateServerSettings({ geminiKey: '' });

    expect(useAppStore.getState().geminiKey).toBeNull();
    expect(await db.getLocalKeyBlob()).toBeNull();
  });
});
