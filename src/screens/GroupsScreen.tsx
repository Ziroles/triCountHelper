import { useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { Banner } from '../ui/Banner';
import { useAppStore } from '../store/useAppStore';
import { useLongPress } from '../hooks/useLongPress';
import { formatShortDate } from '../lib/export';
import type { GroupSummary } from '../types';

/**
 * Home: the user's groups.
 *
 * A group is a tricount. You join one by pasting its share link, and its
 * participants come along with it — that is the whole point: nobody retypes by
 * hand the list of people they split their shopping with.
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
        {group.lastActivityAt ? `, dernier ticket le ${formatShortDate(group.lastActivityAt)}` : ''}
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
  const lostAccountEmail = useAppStore((s) => s.lostAccountEmail);
  const dismissLostAccount = useAppStore((s) => s.dismissLostAccount);
  const [pendingLeave, setPendingLeave] = useState<GroupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen
      title="Groupes"
      action={
        <button type="button" className="linkButton" onClick={() => navigate({ name: 'settings' })}>
          Réglages
        </button>
      }
      banner={
        lostAccountEmail ? (
          <Banner
            tone="warn"
            label="Session perdue"
            action={
              <>
                <Button variant="primary" onClick={() => navigate({ name: 'settings' })}>
                  Se reconnecter
                </Button>
                <button type="button" className="linkButton" onClick={dismissLostAccount}>
                  Continuer sans compte
                </button>
              </>
            }
          >
            <strong>Reconnectez-vous.</strong> Cet appareil n’est plus connecté au compte{' '}
            {lostAccountEmail} : le navigateur a effacé ses données. Vos groupes et votre clé
            Gemini sont sur le compte.
          </Banner>
        ) : loadError ? (
          <Banner tone="warn">{loadError}</Banner>
        ) : null
      }
      footer={
        <Button variant="primary" full disabled={!online} onClick={() => navigate({ name: 'join' })}>
          Lier un groupe Tricount
        </Button>
      }
    >
      {groups.length === 0 ? (
        loading ? (
          <p className="empty">Chargement…</p>
        ) : (
          <p className="empty">
            Aucun groupe pour l’instant. Liez un tricount avec son lien de partage : ses
            participants viendront avec.
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
                <span aria-hidden="true">✕</span>
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
