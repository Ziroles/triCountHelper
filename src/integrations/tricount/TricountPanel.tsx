import { useState } from 'react';
import { Button } from '../../ui/Button';
import { useGroupPeople } from '../../hooks/useGroupPeople';
import { receiptTitle } from '../../lib/export';
import { personById } from '../../lib/people';
import * as api from '../../api';
import type { Settlement } from '../../lib/compute';
import type { Receipt } from '../../types';

type TricountPanelProps = {
  receipt: Receipt;
  settlement: Settlement;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; transactionId: string }
  | { kind: 'failed'; message: string };

/**
 * Envoi de la dépense dans le tricount du groupe.
 *
 * Ce panneau ne demande plus ni adresse de relais, ni jeton, ni lien de partage :
 * le groupe *est* le tricount, et le serveur sait où écrire. Il ne reste qu'une
 * question à poser — qui a payé.
 *
 * Les parts partent avec les **uuid** des membres. L'appariement par nom, qui
 * échouait sur un accent ou une majuscule, n'existe plus.
 */
export function TricountPanel({ receipt, settlement }: TricountPanelProps) {
  const people = useGroupPeople();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [payer, setPayer] = useState<string>('');

  const involved = settlement.people
    .map((entry) => ({ ...entry, person: personById(people, entry.personId) }))
    .filter((entry) => entry.person !== undefined);

  if (involved.length === 0) return null;

  const activePayer =
    involved.some((entry) => entry.personId === payer) ? payer : (involved[0]?.personId ?? '');

  const shares = involved
    .filter((entry) => entry.totalCents !== 0)
    .map((entry) => ({ memberUuid: entry.personId, amountCents: entry.totalCents }));

  const send = async () => {
    setStatus({ kind: 'busy' });
    try {
      const { transactionId } = await api.pushExpense(receipt.id, {
        description: receiptTitle(receipt),
        totalCents: settlement.distributedTotalCents,
        payerMemberUuid: activePayer,
        shares,
        date: receipt.purchaseDate,
      });
      setStatus({ kind: 'done', transactionId });
    } catch (error) {
      setStatus({
        kind: 'failed',
        message:
          error instanceof Error
            ? error.message
            : "L'envoi n'a pas fonctionné. Utilisez la copie manuelle.",
      });
    }
  };

  return (
    <section className="section">
      <h2>Tricount</h2>
      <p className="muted">
        Une dépense unique, répartie selon les montants ci-dessus, dans le tricount de ce
        groupe.
      </p>
      <label className="field">
        <span className="field__label">Qui a payé</span>
        <select value={activePayer} onChange={(event) => setPayer(event.target.value)}>
          {involved.map((entry) => (
            <option key={entry.personId} value={entry.personId}>
              {entry.person?.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="primary"
        full
        disabled={status.kind === 'busy' || shares.length === 0 || activePayer === ''}
        onClick={() => void send()}
      >
        {status.kind === 'busy' ? 'Envoi…' : 'Envoyer vers Tricount'}
      </Button>
      {status.kind === 'done' ? (
        <p className="muted">Dépense envoyée. Elle apparaît dans Tricount.</p>
      ) : null}
      {status.kind === 'failed' ? (
        <>
          <p className="warnText">{status.message}</p>
          <p className="muted">
            La copie du récapitulatif, juste au-dessus, reste toujours disponible.
          </p>
        </>
      ) : null}
    </section>
  );
}
