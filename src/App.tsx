import { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import {
  registerServiceWorker,
  subscribeInstall,
  subscribeUpdates,
  promptInstall,
  refreshApp,
} from './pwa';
import { GroupsScreen } from './screens/GroupsScreen';
import { GroupScreen } from './screens/GroupScreen';
import { JoinGroupScreen } from './screens/JoinGroupScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ReceiptFlow } from './screens/ReceiptFlow';
import { LegacyImport } from './screens/LegacyImport';

function useTheme(): void {
  const theme = useAppStore((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

function StatusStrip() {
  const online = useAppStore((s) => s.online);
  const contractMismatch = useAppStore((s) => s.contractMismatch);
  const [installable, setInstallable] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => subscribeInstall(setInstallable), []);
  useEffect(() => subscribeUpdates((state) => setNeedRefresh(state.needRefresh)), []);

  /* A contract mismatch comes before everything else: it explains failures that
     would otherwise look inexplicable. */
  if (contractMismatch) {
    return (
      <div className="strip">
        <span>
          Cette application et le serveur ne sont pas de la même version. Certaines actions
          peuvent échouer — rechargez, ou prévenez la personne qui héberge le service.
        </span>
        <button type="button" className="strip__link" onClick={() => window.location.reload()}>
          Recharger
        </button>
      </div>
    );
  }

  if (needRefresh) {
    return (
      <div className="strip">
        <span>Une nouvelle version est prête.</span>
        <button type="button" className="strip__link" onClick={refreshApp}>
          Recharger
        </button>
      </div>
    );
  }

  if (!online) {
    return (
      <div className="strip">
        <span>Hors ligne — consultation seulement, les modifications attendront le réseau.</span>
      </div>
    );
  }

  if (installable && !dismissed) {
    return (
      <div className="strip">
        <span>Installer SplitTicket sur cet appareil ?</span>
        <button type="button" className="strip__link" onClick={() => void promptInstall()}>
          Installer
        </button>
        <button type="button" className="strip__link" onClick={() => setDismissed(true)}>
          Plus tard
        </button>
      </div>
    );
  }

  return null;
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const route = useAppStore((s) => s.route);
  const init = useAppStore((s) => s.init);
  useTheme();

  useEffect(() => {
    void init();
    void registerServiceWorker();
  }, [init]);

  if (!ready) {
    return (
      <div className="app">
        <div className="app__loading">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <StatusStrip />
      <LegacyImport />
      {route.name === 'groups' ? <GroupsScreen /> : null}
      {route.name === 'join' ? <JoinGroupScreen /> : null}
      {route.name === 'settings' ? <SettingsScreen /> : null}
      {route.name === 'group' ? <GroupScreen groupId={route.groupId} /> : null}
      {route.name === 'receipt' ? (
        <ReceiptFlow groupId={route.groupId} receiptId={route.receiptId} step={route.step} />
      ) : null}
    </div>
  );
}
