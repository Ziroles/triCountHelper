import { useEffect, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { Banner } from '../ui/Banner';
import { PersonPill } from '../ui/PersonPill';
import { useAppStore } from '../store/useAppStore';
import { useGroupPeople } from '../hooks/useGroupPeople';
import { useLongPress } from '../hooks/useLongPress';
import { formatAmount } from '../lib/money';
import { formatShortDate } from '../lib/export';
import type { ReceiptSummary } from '../types';

/** A group's receipts, and its participants as Tricount knows them. */

function ReceiptRow({
  receipt,
  onOpen,
  onLongPress,
}: {
  receipt: ReceiptSummary;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const press = useLongPress({ onLongPress, onClick: onOpen });
  return (
    <button type="button" className="list__main" {...press}>
      <span className={`list__title${receipt.merchant?.trim() ? '' : ' list__title--empty'}`}>
        {receipt.merchant?.trim() || 'Ticket sans nom'}
        {receipt.status === 'settled' ? <span className="tag">réglé</span> : null}
      </span>
      <span className="list__meta">
        {formatShortDate(receipt.purchaseDate ?? receipt.createdAt)}, {receipt.lineCount} ligne
        {receipt.lineCount > 1 ? 's' : ''}
      </span>
    </button>
  );
}

type GroupScreenProps = { groupId: string };

export function GroupScreen({ groupId }: GroupScreenProps) {
  const group = useAppStore((s) => s.group);
  const people = useGroupPeople();
  const receipts = useAppStore((s) => s.receipts);
  const online = useAppStore((s) => s.online);
  const loading = useAppStore((s) => s.loadingReceipts);
  const loadError = useAppStore((s) => s.loadError);
  const navigate = useAppStore((s) => s.navigate);
  const goBack = useAppStore((s) => s.goBack);
  const openGroup = useAppStore((s) => s.openGroup);
  const createReceipt = useAppStore((s) => s.createReceipt);
  const removeReceipt = useAppStore((s) => s.removeReceipt);
  const refreshMembers = useAppStore((s) => s.refreshMembers);

  const [pendingDelete, setPendingDelete] = useState<ReceiptSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void openGroup(groupId);
  }, [groupId, openGroup]);


  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const receipt = await createReceipt(groupId);
      navigate({ name: 'receipt', groupId, receiptId: receipt.id, step: 'capture' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le ticket n’a pas pu être créé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={group?.title ?? 'Groupe'}
      onBack={() => goBack({ name: 'groups' })}
      banner={loadError ? <Banner tone="warn">{loadError}</Banner> : null}
      footer={
        <>
          <Button variant="primary" full disabled={busy || !online} onClick={() => void start()}>
            {busy ? 'Création…' : 'Nouveau ticket'}
          </Button>
          {!online ? (
            <p className="muted muted--center">
              Hors ligne : consultation seulement. Créer un ticket demande le réseau.
            </p>
          ) : null}
        </>
      }
    >
      <section className="groupPeople" aria-label="Participants">
        <div className="groupPeople__head">
          <h2>Participants</h2>
          <button
            type="button"
            className="linkButton"
            disabled={!online}
            onClick={() => void refreshMembers(groupId).catch(() => undefined)}
          >
            Rafraîchir
          </button>
        </div>
        {people.length === 0 ? (
          <p className="muted">
            Aucun participant lu depuis le tricount. Ajoutez-en dans Tricount, puis
            rafraîchissez.
          </p>
        ) : (
          <ul className="groupPeople__row">
            {people.map((person) => (
              <li key={person.id} className="groupPeople__person">
                <PersonPill person={person} size="md" />
                <span aria-hidden="true">{person.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error ? <p className="warnText">{error}</p> : null}

      <section className="stack">
        <h2>Tickets</h2>
        {receipts.length === 0 ? (
          <p className="empty">
            {loading ? 'Chargement…' : 'Aucun ticket. Photographiez-en un, ou saisissez-le à la main.'}
          </p>
        ) : (
          <ul className="list">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="list__row">
                <ReceiptRow
                  receipt={receipt}
                  onOpen={() =>
                    navigate({
                      name: 'receipt',
                      groupId,
                      receiptId: receipt.id,
                      step: receipt.step,
                    })
                  }
                  onLongPress={() => setPendingDelete(receipt)}
                />
                <span className="list__amount num">{formatAmount(receipt.totalCents)}</span>
                <button
                  type="button"
                  className="iconButton iconButton--quiet"
                  aria-label={`Supprimer ${receipt.merchant ?? 'ce ticket'}`}
                  onClick={() => setPendingDelete(receipt)}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={pendingDelete !== null}
        title="Supprimer ce ticket"
        onClose={() => setPendingDelete(null)}
        footer={
          <div className="row row--gap">
            <Button full onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void removeReceipt(target.id).catch(() => undefined);
              }}
            >
              Supprimer
            </Button>
          </div>
        }
      >
        <p className="muted">
          {pendingDelete?.merchant?.trim() || 'Ce ticket'} et sa photo seront effacés pour{' '}
          <strong>tous les participants</strong> du groupe. Cette action est irréversible.
        </p>
      </Sheet>
    </Screen>
  );
}
