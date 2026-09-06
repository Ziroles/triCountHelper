import { useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { Banner } from '../ui/Banner';
import { useAppStore } from '../store/useAppStore';
import { useLongPress } from '../hooks/useLongPress';
import { formatFrenchDate } from '../lib/export';
import type { GroupSummary } from '../types';

/**
 * Accueil : les groupes de l'utilisateur.
 *
 * Un groupe est un tricount. On en rejoint un en collant son lien de partage,
 * et ses participants viennent avec — c'est tout le propos : plus personne ne
 * ressaisit à la main la liste des gens avec qui il partage ses courses.
 */

function GroupRow({
  group,
  onOpen,
  onLongPress,
}: {
  group: GroupSummary;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const press = useLongPress({ onLongPress, onClick: onOpen });
  return (
    <button type="button" className="list__main" {...press}>
      <span className="list__title">{group.title}</span>
      <span className="list__meta">
        {group.memberCount} participant{group.memberCount > 1 ? 's' : ''}
        {' · '}
        {group.receiptCount} ticket{group.receiptCount > 1 ? 's' : ''}
        {group.lastActivityAt ? ` · ${formatFrenchDate(group.lastActivityAt)}` : ''}
      </span>
    </button>
  );
}

export function GroupsScreen() {
  const groups = useAppStore((s) => s.groups);
  const online = useAppStore((s) => s.online);
  const loading = useAppStore((s) => s.loadingGroups);
  const loadError = useAppStore((s) => s.loadError);
  const navigate = useAppStore((s) => s.navigate);
  const leaveGroup = useAppStore((s) => s.leaveGroup);
  const [pendingLeave, setPendingLeave] = useState<GroupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen
      title="SplitTicket"
      action={
        <button type="button" className="linkButton" onClick={() => navigate({ name: 'settings' })}>
          Réglages
        </button>
      }
      banner={loadError ? <Banner tone="warn">{loadError}</Banner> : null}
      footer={
        <Button variant="primary" full disabled={!online} onClick={() => navigate({ name: 'join' })}>
          Rejoindre un groupe
        </Button>
      }
    >
      {groups.length === 0 ? (
        loading ? (
          <p className="empty">Chargement…</p>
        ) : (
          <p className="empty">
            Aucun groupe pour l’instant. Collez le lien de partage d’un tricount : ses
            participants viendront avec, et vos tickets s’y rangeront.
          </p>
        )
      ) : (
        <ul className="list">
          {groups.map((group) => (
            <li key={group.id} className="list__row">
              <GroupRow
                group={group}
                onOpen={() => navigate({ name: 'group', groupId: group.id })}
                onLongPress={() => setPendingLeave(group)}
              />
              <button
                type="button"
                className="iconButton iconButton--quiet"
                aria-label={`Quitter ${group.title}`}
                onClick={() => setPendingLeave(group)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {!online ? (
        <p className="muted">
          Hors ligne : vous consultez la dernière version connue. Rejoindre un groupe ou
          modifier un ticket demandera le réseau.
        </p>
      ) : null}

      <Sheet
        open={pendingLeave !== null}
        title="Quitter ce groupe"
        onClose={() => {
          setPendingLeave(null);
          setError(null);
        }}
        footer={
          <div className="row row--gap">
            <Button full onClick={() => setPendingLeave(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => {
                const target = pendingLeave;
                if (!target) return;
                void leaveGroup(target.id)
                  .then(() => setPendingLeave(null))
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : 'Échec.'),
                  );
              }}
            >
              Quitter
            </Button>
          </div>
        }
      >
        <p className="muted">
          {pendingLeave?.title} disparaîtra de cet appareil. Le tricount et ses tickets
          restent intacts pour les autres participants — vous pourrez le rejoindre à nouveau
          avec le même lien.
        </p>
        {error ? <p className="warnText">{error}</p> : null}
      </Sheet>
    </Screen>
  );
}
