/**
 * État de l'application.
 *
 * Le store n'est plus le propriétaire des données : il est le client de l'API,
 * doublé d'un cache. Trois règles le gouvernent.
 *
 * **Lire depuis le cache, puis rafraîchir.** Un écran affiche immédiatement ce
 * qu'il a déjà vu, et se met à jour quand le réseau répond. Hors ligne, il reste
 * simplement sur la dernière version connue.
 *
 * **N'écrire qu'en ligne.** Il n'y a pas de file de rejeu : une modification
 * exige le réseau, et l'interface le dit. Rejouer des écritures sur un ticket
 * que quelqu'un d'autre a modifié entre-temps demanderait de fusionner des
 * montants — c'est-à-dire d'inventer de l'argent.
 *
 * **Une écriture à la fois par ticket.** Les modifications s'accumulent, une
 * seule requête part, et la suivante repart de la version que le serveur vient
 * de rendre. C'est ce qui rend le verrou optimiste utilisable sans que chaque
 * frappe au clavier devienne un conflit.
 */

import { create } from 'zustand';
import * as api from '../api';
import { ApiError, OfflineError } from '../api';
import * as db from '../db';
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
  accountEmail: string | null;

  groups: GroupSummary[];
  group: Group | null;
  receipts: ReceiptSummary[];
  receipt: Receipt | null;

  loadingGroups: boolean;
  loadingReceipts: boolean;
  loadingReceipt: boolean;
  /** Erreur de chargement affichable, distincte des erreurs d'écriture. */
  loadError: string | null;

  saveState: SaveState;
  saveError: string | null;
  /** Version serveur d'un ticket modifié ailleurs, en attente d'arbitrage. */
  conflict: Receipt | null;

  /** Vrai quand le serveur annonce un contrat différent de celui de ce paquet. */
  contractMismatch: boolean;
};

type Actions = {
  init: () => Promise<void>;
  navigate: (route: Route) => void;
  /** Route imposée par l'historique : on la suit sans l'y réempiler. */
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
    geminiApiKey?: string;
    geminiModel?: string;
  }) => Promise<void>;
  refreshMe: () => Promise<void>;
};

export type AppStore = State & Actions;

/**
 * Rejoue le démarrage. Réservé aux tests, qui remontent l'application plusieurs
 * fois dans un même processus et ont besoin que `init` reparte de zéro.
 */
export let resetForTests: () => void = () => undefined;

/** Participants d'un groupe, dans la forme attendue par `lib/compute.ts`. */
export function peopleOf(group: Group | null): Person[] {
  if (!group) return [];
  return group.members.map((member, index) => ({
    id: member.uuid,
    name: member.displayName,
    color: colorForIndex(index),
  }));
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur inattendue est survenue.';
}

export const useAppStore = create<AppStore>((set, get) => {
  // ── Écriture différée ──────────────────────────────────────────────────────
  // Une seule requête en vol par ticket ; les frappes suivantes attendent leur
  // tour plutôt que de partir en parallèle et de se déclarer mutuellement
  // périmées.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  /** Démarrage en cours ou déjà fait — voir `init`. */
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
    if (!current || get().conflict) return;

    if (inFlight) {
      dirty = true;
      return inFlight;
    }

    set({ saveState: 'saving', saveError: null });
    inFlight = (async () => {
      try {
        const saved = await api.writeReceipt(current);
        // On n'adopte que la version : le document local a pu avancer pendant
        // le vol, et l'écraser ferait perdre les frappes de l'utilisateur.
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
          set({ saveState: 'offline', saveError: error.message });
          return;
        }
        if (error instanceof ApiError && error.code === 'version_conflict') {
          const payload = error.payload as { current?: unknown } | undefined;
          set({
            saveState: 'conflict',
            saveError: 'Ce ticket a été modifié sur un autre appareil.',
            conflict: (payload?.current as Receipt | undefined) ?? null,
          });
          return;
        }
        set({ saveState: 'error', saveError: messageOf(error) });
      }
    })().finally(() => {
      inFlight = null;
      if (dirty) {
        dirty = false;
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
    // Quitter l'écran ne doit pas perdre la dernière frappe.
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
     * Démarrage, **idempotent**.
     *
     * React invoque les effets deux fois en développement (StrictMode), et un
     * second démarrage naïf réécraserait la liste fraîchement chargée par un
     * cache encore vide : la liste disparaîtrait puis reviendrait, et tout ce
     * qui était en cours de clic serait démonté au passage. La promesse est donc
     * mémorisée, et le cache ne s'applique qu'à un écran encore vide.
     */
    init() {
      if (starting !== null) return starting;
      starting = (async () => {
        const [settings, groups] = await Promise.all([db.getSettings(), db.cachedGroups()]);
        set((state) => ({
          settings,
          // Le réseau a pu répondre pendant qu'on lisait le cache : il est plus
          // récent par construction, on ne le recouvre pas.
          groups: state.groups.length > 0 ? state.groups : groups,
          ready: true,
        }));

        const setOnline = () => {
          const online = navigator.onLine;
          set({ online });
          if (online && get().saveState === 'offline') void push();
        };
        window.addEventListener('online', setOnline);
        window.addEventListener('offline', setOnline);

        /* L'adresse fait foi au chargement : un signet, un lien partagé ou un
           rechargement ouvrent l'écran attendu, pas l'accueil. */
        const opening = currentRoute();
        window.history.replaceState({ route: opening }, '', routeToPath(opening));
        set({ route: opening });

        window.addEventListener('popstate', (event) => {
          const state = (event.state ?? null) as { route?: Route } | null;
          get().adoptRoute(state?.route ?? currentRoute());
        });

        /* Compatibilité : l'API et l'application se déploient séparément, et
           une divergence ne se remarquerait sinon qu'au premier appel qui
           répond autre chose que prévu. Un échec de /health n'est pas une
           divergence — c'est peut-être simplement le réseau. */
        void api
          .health()
          .then((info) => set({ contractMismatch: info.contractVersion !== api.CONTRACT_VERSION }))
          .catch(() => undefined);

        await Promise.all([get().refreshGroups(), get().refreshMe()]);
      })();
      return starting;
    },

    navigate(route) {
      cancelTimer();
      void push();
      set({ route, loadError: null });
      if (typeof window !== 'undefined') {
        window.history.pushState({ route }, '', routeToPath(route));
      }
    },

    adoptRoute(route) {
      // Le geste retour a déjà déplacé l'historique : republier l'entrée
      // enfermerait l'utilisateur dans l'application, incapable d'en sortir.
      cancelTimer();
      void push();
      set({ route, loadError: null });
    },

    // ── Groupes ──────────────────────────────────────────────────────────────

    async refreshGroups() {
      set({ loadingGroups: true });
      try {
        const groups = await api.listGroups();
        set({ groups, loadError: null });
        void db.cacheGroups(groups);
      } catch (error) {
        // Hors ligne, la liste en cache reste la bonne réponse à afficher.
        if (!(error instanceof OfflineError)) set({ loadError: messageOf(error) });
      } finally {
        set({ loadingGroups: false });
      }
    },

    async openGroup(groupId) {
      const [cachedGroup, cachedList] = await Promise.all([
        db.cachedGroup(groupId),
        db.cachedReceiptList(groupId),
      ]);
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
        set({ group, receipts });
        void db.cacheGroup(group);
        void db.cacheReceiptList(groupId, receipts);
      } catch (error) {
        if (!(error instanceof OfflineError)) set({ loadError: messageOf(error) });
      } finally {
        set({ loadingReceipts: false });
      }
    },

    async joinGroup(shareUrl) {
      const group = await api.joinGroup(shareUrl);
      void db.cacheGroup(group);
      await get().refreshGroups();
      return group;
    },

    async refreshMembers(groupId) {
      const group = await api.refreshMembers(groupId);
      set({ group });
      void db.cacheGroup(group);
    },

    async leaveGroup(groupId) {
      await api.leaveGroup(groupId);
      set((state) => ({
        groups: state.groups.filter((entry) => entry.id !== groupId),
        group: state.group?.id === groupId ? null : state.group,
      }));
      void db.cacheGroups(get().groups);
    },

    // ── Tickets ──────────────────────────────────────────────────────────────

    async openReceipt(receiptId) {
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
        set({ receipt });
        void db.cacheReceipt(receipt);
      } catch (error) {
        if (!(error instanceof OfflineError)) set({ loadError: messageOf(error) });
      } finally {
        set({ loadingReceipt: false });
      }
    },

    async createReceipt(groupId) {
      const receipt = await api.createReceipt(groupId);
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
      await api.deleteReceipt(receiptId);
      set((state) => ({
        receipts: state.receipts.filter((entry) => entry.id !== receiptId),
        receipt: state.receipt?.id === receiptId ? null : state.receipt,
      }));
      void db.dropReceipt(receiptId);
    },

    keepServerVersion() {
      // L'utilisateur renonce à ses corrections : on repart de la version du
      // serveur, qui redevient la base des prochaines écritures.
      const server = get().conflict;
      if (!server) return;
      set({ receipt: server, conflict: null, saveState: 'idle', saveError: null });
      void db.cacheReceipt(server);
    },

    dismissSaveError() {
      set({ saveError: null, saveState: 'idle' });
    },

    // ── Réglages ─────────────────────────────────────────────────────────────

    async updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      await db.putSettings(settings);
      set({ settings });
    },

    async updateServerSettings(patch) {
      const server = await api.updateServerSettings(patch);
      set({ server });
    },

    async refreshMe() {
      try {
        const me = await api.me();
        set({ server: me.settings, accountEmail: me.accountEmail });
      } catch {
        // Sans réseau, on garde ce qu'on savait : les réglages serveur ne
        // bloquent aucun écran.
      }
    },
  };
});
