import { logger } from './lib/log';

const log = logger('pwa');

export type UpdateState = {
  needRefresh: boolean;
  offlineReady: boolean;
};

type Listener = (state: UpdateState) => void;

let state: UpdateState = { needRefresh: false, offlineReady: false };
const listeners = new Set<Listener>();
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

function emit(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function subscribeUpdates(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function refreshApp(): void {
  log.info('reload requested to apply the update');
  void applyUpdate?.(true);
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    log.info('no service worker on this browser');
    return;
  }
  try {
    const { registerSW } = await import('virtual:pwa-register');
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        log.info('new version waiting for a reload');
        emit({ needRefresh: true });
      },
      onOfflineReady: () => {
        log.info('application available offline');
        emit({ offlineReady: true });
      },
    });
    log.debug('service worker registered');
  } catch (error) {
    /* A service worker that fails to register leaves a working application —
       but no longer offline, and with nothing to say so. */
    log.warn('service worker registration failed', error);
  }
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    for (const listener of installListeners) listener(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    for (const listener of installListeners) listener(false);
  });
}

export function subscribeInstall(listener: (available: boolean) => void): () => void {
  installListeners.add(listener);
  listener(deferredPrompt !== null);
  return () => installListeners.delete(listener);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  log.info('install prompt', { outcome });
  deferredPrompt = null;
  for (const listener of installListeners) listener(false);
  return outcome === 'accepted';
}
