import { useRef, useState } from 'react';
import { receiptTitle } from '../../lib/export';
import { logger } from '../../lib/log';
import { recall, remember } from '../../lib/deviceMemory';
import * as api from '../../api';
import type { Settlement } from '../../lib/compute';
import type { Receipt } from '../../types';

const log = logger('tricount');

export type PushStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; transactionId: string; totalCents: number; payer: string }
  | { kind: 'failed'; message: string };

/** The tricount's own page. The API returns no address for the expense itself. */
export function tricountUrl(groupId: string): string {
  return `https://tricount.com/${encodeURIComponent(groupId)}`;
}

/**
 * Sends the expense into the group's tricount.
 *
 * No relay address, token or share link to ask for: the group *is* the
 * tricount, and the server knows where to write. Only one question is left —
 * who paid — and the screen asks it before the send.
 *
 * The shares go out with the members' **uuids**. Matching by name, which failed
 * on an accent or a capital letter, is gone.
 */
export function useTricountPush(receipt: Receipt, settlement: Settlement) {
  const [status, setStatus] = useState<PushStatus>({ kind: 'idle' });
  const inFlight = useRef(false);

  const shares = settlement.people
    .filter((entry) => entry.totalCents !== 0)
    .map((entry) => ({ memberUuid: entry.personId, amountCents: entry.totalCents }));

  /** What identifies an expense: sending the same one twice makes a duplicate. */
  const fingerprint = (payer: string) =>
    JSON.stringify({ total: settlement.distributedTotalCents, payer, shares });

  /** The last send from this device, if any — Tricount itself cannot be asked. */
  const lastSent = recall(receipt.id).sent ?? null;

  const send = async (payer: string) => {
    // One request at a time, whatever the button says: a double tap must not
    // become two expenses.
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus({ kind: 'busy' });
    /* A send to a third-party system, and therefore irreversible from here: the
       trace must make it possible to reconstruct what went out, share by share,
       if the tricount displays something other than what was expected. */
    const done = log.time(`sending the expense for receipt ${receipt.id}`);
    log.info('sending to the tricount', {
      receipt: receipt.id,
      payer,
      totalCents: settlement.distributedTotalCents,
      shares,
    });
    try {
      const { transactionId } = await api.pushExpense(receipt.id, {
        description: receiptTitle(receipt),
        totalCents: settlement.distributedTotalCents,
        payerMemberUuid: payer,
        shares,
        date: receipt.purchaseDate,
      });
      done(`transaction ${transactionId}`);
      remember(receipt.id, {
        sent: { fingerprint: fingerprint(payer), at: new Date().toISOString() },
      });
      setStatus({
        kind: 'done',
        transactionId,
        totalCents: settlement.distributedTotalCents,
        payer,
      });
    } catch (error) {
      log.error('send to the tricount failed', error);
      setStatus({
        kind: 'failed',
        message:
          error instanceof Error
            ? error.message
            : "L'envoi n'a pas fonctionné. Utilisez la copie du récap.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  return {
    status,
    shares,
    send,
    fingerprint,
    lastSent,
    reset: () => setStatus({ kind: 'idle' }),
  };
}
