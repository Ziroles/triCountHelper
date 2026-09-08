/**
 * Application state.
 *
 * The store no longer owns the data: it is the API client, doubled as a cache.
 * Three rules govern it.
 *
 * **Read from the cache, then refresh.** A screen immediately shows what it has
 * already seen, and updates when the network answers. Offline, it simply stays
 * on the last known version.
 *
 * **Only write while online.** There is no replay queue: a change requires the
 * network, and the interface says so. Replaying writes onto a receipt someone
 * else has changed in the meantime would mean merging amounts — that is,
 * inventing money.
 *
 * **One write at a time per receipt.** Changes pile up, a single request goes
 * out, and the next one starts from the version the server just returned. That
 * is what makes the optimistic lock usable without every keystroke turning into
 * a conflict.
 */

import { create } from 'zustand';
import * as api from '../api';
import { ApiError, OfflineError } from '../api';
import * as db from '../db';
import { open as openSealed, seal } from '../lib/crypto';
import { logger } from '../lib/log';
import { colorForIndex } from '../lib/people';
import { currentRoute, routeToPath } from '../lib/routing';
import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_SETTINGS,
  type Group,
  type GroupSummary,
  type Person,
  type Receipt,
  type ReceiptStep,
  type ReceiptSummary,
  type ServerSettings,
  type Settings,
} from '../types';

export type Route =
  | { name: 'groups' }
  | { name: 'join' }
  | { name: 'settings' }
  | { name: 'group'; groupId: string }
  | { name: 'receipt'; groupId: string; receiptId: string; step: ReceiptStep };

export type SaveState = 'idle' | 'saving' | 'offline' | 'error' | 'conflict';

type State = {
  ready: boolean;
  online: boolean;
  route: Route;

  settings: Settings;
  server: ServerSettings;
  /**
   * The user's Gemini key, opened from `server.geminiKeyBlob`. In memory only:
   * it is never written anywhere, and the API has never seen it. Null means
   * either "none saved" or "the local key cannot open the blob any more",
   * which the settings screen tells apart.
   */
  geminiKey: string | null;
  accountEmail: string | null;

  groups: GroupSummary[];
  group: Group | null;
  receipts: ReceiptSummary[];
  receipt: Receipt | null;

  loadingGroups: boolean;
  loadingReceipts: boolean;
  loadingReceipt: boolean;
  /** Displayable load error, distinct from write errors. */
  loadError: string | null;

  saveState: SaveState;
  saveError: string | null;
  /** Server version of a receipt changed elsewhere, awaiting arbitration. */
  conflict: Receipt | null;

  /** True when the server announces a contract different from this bundle's. */
  contractMismatch: boolean;
};

type Actions = {
  init: () => Promise<void>;
  navigate: (route: Route) => void;
  /** Route imposed by history: follow it without pushing it back on. */
  adoptRoute: (route: Route) => void;

  refreshGroups: () => Promise<void>;
  openGroup: (groupId: string) => Promise<void>;
  joinGroup: (shareUrl: string) => Promise<Group>;
  refreshMembers: (groupId: string) => Promise<void>;
  leaveGroup: (groupId: string) => Promise<void>;

  openReceipt: (receiptId: string) => Promise<void>;
  createReceipt: (groupId: string) => Promise<Receipt>;
  updateReceipt: (patch: Partial<Receipt> | ((r: Receipt) => Receipt)) => void;
  saveNow: () => Promise<void>;
  removeReceipt: (receiptId: string) => Promise<void>;
  keepServerVersion: () => void;
  dismissSaveError: () => void;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  updateServerSettings: (patch: {
    /** In the clear here, sealed before it leaves. "" clears the stored key. */
    geminiKey?: string;
    geminiModel?: string;
  }) => Promise<void>;
  refreshMe: () => Promise<void>;
};

export type AppStore = State & Actions;

/**
 * Replays start-up. Reserved for tests, which mount the application several
 * times in a single process and need `init` to start over from scratch.
 */
export let resetForTests: () => void = () => undefined;

/**
 * Blob → Gemini key, with the locally kept KEK.
 *
 * Every failure lands on the same answer, null: no blob, no KEK yet, or a
 * password changed elsewhere. The screen shows one state — "no key here" — and
 * offers to enter it again, which is the only thing to do in all three cases.
 */
async function openStoredKey(blob: string | null): Promise<string | null> {
  if (blob === null) return null;
  const kek = await db.getKek();
  return kek === null ? null : openSealed(kek, blob);
}

/** A group's participants, in the shape `lib/compute.ts` expects. */
export function peopleOf(group: Group | null): Person[] {
  if (!group) return [];
  return group.members.map((member, index) => ({
    id: member.uuid,
    name: member.displayName,
    color: colorForIndex(index),
  }));
}

const log = logger('store');

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur inattendue est survenue.';
}

export const useAppStore = create<AppStore>((set, get) => {
  // ── Deferred writing ───────────────────────────────────────────────────────
  // A single request in flight per receipt; later keystrokes wait their turn
  // rather than going out in parallel and declaring each other stale.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  /** Start-up in progress or already done — see `init`. */
  let starting: Promise<void> | null = null;
  resetForTests = () => {
    starting = null;
    inFlight = null;
    dirty = false;
    cancelTimer();
  };

  function cancelTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  async function push(): Promise<void> {
    const current = get().receipt;
    if (!current || get().conflict) {
      if (current) log.debug('write suspended: conflict awaiting arbitration');
      return;
    }

    if (inFlight) {
      log.debug('write already in flight, queued', { receipt: current.id });
      dirty = true;
      return inFlight;
    }

    set({ saveState: 'saving', saveError: null });
    const done = log.time(`writing receipt ${current.id}`);
    inFlight = (async () => {
      try {
        const saved = await api.writeReceipt(current);
        done(`version ${current.version} → ${saved.version}`);
        // We only adopt the version: the local document may have moved on
        // during the flight, and overwriting it would lose the user's typing.
        set((state) =>
          state.receipt && state.receipt.id === saved.id
            ? {
                receipt: { ...state.receipt, version: saved.version, updatedAt: saved.updatedAt },
                saveState: 'idle',
              }
            : { saveState: 'idle' },
        );
        const after = get().receipt;
        if (after && after.id === saved.id) void db.cacheReceipt(after);
      } catch (error) {
        if (error instanceof OfflineError) {
          log.warn('write postponed: offline', { receipt: current.id });
          set({ saveState: 'offline', saveError: error.message });
          return;
        }
        if (error instanceof ApiError && error.code === 'version_conflict') {
          const payload = error.payload as { current?: unknown } | undefined;
          log.warn('version conflict: the receipt moved elsewhere', {
            receipt: current.id,
            localVersion: current.version,
          });
          set({
            saveState: 'conflict',
            saveError: 'Ce ticket a été modifié sur un autre appareil.',
            conflict: (payload?.current as Receipt | undefined) ?? null,
          });
          return;
        }
        log.error('write failed', error);
        set({ saveState: 'error', saveError: messageOf(error) });
      }
    })().finally(() => {
      inFlight = null;
      if (dirty) {
        dirty = false;
        log.debug('changes accumulated during the flight: writing again');
        void push();
      }
    });
    return inFlight;
  }

  function schedulePush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void push();
    }, 500);
  }

  if (typeof document !== 'undefined') {
    // Leaving the screen must not lose the last keystroke.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        cancelTimer();
        void push();
      }
    });
    window.addEventListener('pagehide', () => {
      cancelTimer();
      void push();
    });
  }

  return {
    ready: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    route: { name: 'groups' },

    settings: DEFAULT_SETTINGS,
    server: DEFAULT_SERVER_SETTINGS,
    geminiKey: null,
    accountEmail: null,

    groups: [],
    group: null,
    receipts: [],
    receipt: null,

    loadingGroups: false,
    loadingReceipts: false,
    loadingReceipt: false,
    loadError: null,

    saveState: 'idle',
    saveError: null,
    conflict: null,
    contractMismatch: false,

    /**
     * Start-up, **idempotent**.
     *
     * React runs effects twice in development (StrictMode), and a naive second
     * start-up would overwrite the freshly loaded list with a still-empty
     * cache: the list would disappear then come back, and whatever was mid-click
     * would be unmounted along the way. So the promise is memoised, and the
     * cache only applies to a still-empty screen.
     */
    init() {
      if (starting !== null) return starting;
      const booted = log.time('start-up');
      starting = (async () => {
        const [settings, groups] = await Promise.all([db.getSettings(), db.cachedGroups()]);
        log.info('local cache read', { groups: groups.length });
        set((state) => ({
          settings,
          // The network may have answered while we were reading the cache: it
          // is more recent by construction, so we do not cover it up.
          groups: state.groups.length > 0 ? state.groups : groups,
          ready: true,
        }));

        const setOnline = () => {
          const online = navigator.onLine;
          log.info(online ? 'back online' : 'gone offline');
          set({ online });
          if (online && get().saveState === 'offline') {
            log.info('resuming the postponed write');
            void push();
          }
        };
        window.addEventListener('online', setOnline);
        window.addEventListener('offline', setOnline);

        /* The address is authoritative on load: a bookmark, a shared link or a
           reload open the expected screen, not the home page. */
        const opening = currentRoute();
        log.info('opening route', opening);
        window.history.replaceState({ route: opening }, '', routeToPath(opening));
        set({ route: opening });

        window.addEventListener('popstate', (event) => {
          const state = (event.state ?? null) as { route?: Route } | null;
          get().adoptRoute(state?.route ?? currentRoute());
        });

        /* Compatibility: the API and the app deploy separately, and a mismatch
           would otherwise only show up on the first call that answers something
           other than expected. A /health failure is not a mismatch — it may
           simply be the network. */
        void api
          .health()
          .then((info) => {
            const mismatch = info.contractVersion !== api.CONTRACT_VERSION;
            if (mismatch) {
              log.error('contract mismatch between the app and the API', {
                app: api.CONTRACT_VERSION,
                server: info.contractVersion,
              });
            } else {
              log.info('server online', info);
            }
            set({ contractMismatch: mismatch });
          })
          .catch((error) => log.warn('/health unreachable — the network, probably', error));

        await Promise.all([get().refreshGroups(), get().refreshMe()]);
        booted('application ready');
      })();
      return starting;
    },

    navigate(route) {
      log.info('navigation', route);
      cancelTimer();
      void push();
      set({ route, loadError: null });
      if (typeof window !== 'undefined') {
        window.history.pushState({ route }, '', routeToPath(route));
      }
    },

    adoptRoute(route) {
      // The back gesture has already moved history: republishing the entry
      // would trap the user inside the app, unable to get out.
      log.info('back in history', route);
      cancelTimer();
      void push();
      set({ route, loadError: null });
    },

    // ── Groups ───────────────────────────────────────────────────────────────

    async refreshGroups() {
      set({ loadingGroups: true });
      try {
        const groups = await api.listGroups();
        log.debug('group list refreshed', { groups: groups.length });
        set({ groups, loadError: null });
        void db.cacheGroups(groups);
      } catch (error) {
        // Offline, the cached list is still the right answer to show.
        if (error instanceof OfflineError) log.debug('groups: offline, keeping the cache');
        else {
          log.error('groups: refresh failed', error);
          set({ loadError: messageOf(error) });
        }
      } finally {
        set({ loadingGroups: false });
      }
    },

    async openGroup(groupId) {
      const [cachedGroup, cachedList] = await Promise.all([
        db.cachedGroup(groupId),
        db.cachedReceiptList(groupId),
      ]);
      log.info('opening group', { group: groupId, fromCache: cachedGroup !== null });
      set({
        group: cachedGroup ?? null,
        receipts: cachedList,
        loadingReceipts: true,
        loadError: null,
      });

      try {
        const [group, receipts] = await Promise.all([
          api.readGroup(groupId),
          api.listReceipts(groupId),
        ]);
        log.debug('group loaded', {
          group: groupId,
          members: group.members.length,
          receipts: receipts.length,
        });
        set({ group, receipts });
        void db.cacheGroup(group);
        void db.cacheReceiptList(groupId, receipts);
      } catch (error) {
        if (error instanceof OfflineError) log.debug('group: offline, keeping the cache');
        else {
          log.error('group: load failed', error);
          set({ loadError: messageOf(error) });
        }
      } finally {
        set({ loadingReceipts: false });
      }
    },

    async joinGroup(shareUrl) {
      log.info('joining a group through a share link');
      const group = await api.joinGroup(shareUrl);
      log.info('group joined', { group: group.id, members: group.members.length });
      void db.cacheGroup(group);
      await get().refreshGroups();
      return group;
    },

    async refreshMembers(groupId) {
      const group = await api.refreshMembers(groupId);
      log.info('members resynchronised', { group: groupId, members: group.members.length });
      set({ group });
      void db.cacheGroup(group);
    },

    async leaveGroup(groupId) {
      log.info('leaving group', { group: groupId });
      await api.leaveGroup(groupId);
      set((state) => ({
        groups: state.groups.filter((entry) => entry.id !== groupId),
        group: state.group?.id === groupId ? null : state.group,
      }));
      void db.cacheGroups(get().groups);
    },

    // ── Receipts ─────────────────────────────────────────────────────────────

    async openReceipt(receiptId) {
      log.info('opening receipt', { receipt: receiptId });
      cancelTimer();
      const cached = await db.cachedReceipt(receiptId);
      set({
        receipt: cached ?? null,
        loadingReceipt: true,
        saveState: 'idle',
        saveError: null,
        conflict: null,
      });
      try {
        const receipt = await api.readReceipt(receiptId);
        log.debug('receipt loaded', {
          receipt: receiptId,
          version: receipt.version,
          step: receipt.step,
          lines: receipt.lines.length,
        });
        set({ receipt });
        void db.cacheReceipt(receipt);
      } catch (error) {
        if (error instanceof OfflineError) log.debug('receipt: offline, keeping the cache');
        else {
          log.error('receipt: load failed', error);
          set({ loadError: messageOf(error) });
        }
      } finally {
        set({ loadingReceipt: false });
      }
    },

    async createReceipt(groupId) {
      const receipt = await api.createReceipt(groupId);
      log.info('receipt created', { receipt: receipt.id, group: groupId });
      set((state) => ({ receipt, saveState: 'idle', saveError: null, conflict: null,
        receipts: state.receipts }));
      void db.cacheReceipt(receipt);
      return receipt;
    },

    updateReceipt(patch) {
      const current = get().receipt;
      if (!current) return;
      const next =
        typeof patch === 'function' ? patch(current) : ({ ...current, ...patch } as Receipt);
      set({ receipt: next });
      void db.cacheReceipt(next);
      schedulePush();
    },

    async saveNow() {
      cancelTimer();
      await push();
    },

    async removeReceipt(receiptId) {
      log.info('deleting receipt', { receipt: receiptId });
      await api.deleteReceipt(receiptId);
      set((state) => ({
        receipts: state.receipts.filter((entry) => entry.id !== receiptId),
        receipt: state.receipt?.id === receiptId ? null : state.receipt,
      }));
      void db.dropReceipt(receiptId);
    },

    keepServerVersion() {
      // The user gives up on their edits: we start again from the server
      // version, which becomes the base for the next writes.
      const server = get().conflict;
      if (!server) return;
      log.info('conflict arbitrated: the server version wins', {
        receipt: server.id,
        version: server.version,
      });
      set({ receipt: server, conflict: null, saveState: 'idle', saveError: null });
      void db.cacheReceipt(server);
    },

    dismissSaveError() {
      set({ saveError: null, saveState: 'idle' });
    },

    // ── Settings ─────────────────────────────────────────────────────────────

    async updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      await db.putSettings(settings);
      set({ settings });
    },

    async updateServerSettings(patch) {
      // The field names, never the values: one of them is a Gemini key.
      log.info('server settings changed', { fields: Object.keys(patch) });

      const wire: { geminiKeyBlob?: string; geminiModel?: string } = {};
      if (patch.geminiModel !== undefined) wire.geminiModel = patch.geminiModel;

      let geminiKey = get().geminiKey;
      if (patch.geminiKey !== undefined) {
        const key = patch.geminiKey.trim();
        if (key === '') {
          wire.geminiKeyBlob = '';
          geminiKey = null;
        } else {
          const kek = await db.getKek();
          if (kek === null) {
            // No account, or a session never opened on this device: there is
            // nothing to seal with, and storing an unopenable blob would be
            // worse than refusing.
            throw new Error('account_required');
          }
          wire.geminiKeyBlob = await seal(kek, key);
          geminiKey = key;
        }
      }

      const server = await api.updateServerSettings(wire);
      set({ server, geminiKey });
    },

    async refreshMe() {
      try {
        const me = await api.me();
        log.debug('identity and server settings', {
          device: me.deviceId,
          account: me.accountEmail !== null,
          geminiKey: me.settings.geminiKeyBlob !== null,
          model: me.settings.geminiModel,
        });
        set({
          server: me.settings,
          geminiKey: await openStoredKey(me.settings.geminiKeyBlob),
          accountEmail: me.accountEmail,
        });
      } catch (error) {
        log.debug('server settings unavailable, keeping the previous ones', error);
        // With no network we keep what we knew: server settings do not block
        // any screen.
      }
    },
  };
});
