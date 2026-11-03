import { useMemo, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { Sheet } from '../ui/Sheet';
import { PersonPill } from '../ui/PersonPill';
import { ShareIcon } from '../ui/ShareIcon';
import { ChevronRight } from '../ui/Icons';
import { MenuButton, type MenuItem } from '../ui/MenuSheet';
import { useAppStore } from '../store/useAppStore';
import { useGroupPeople } from '../hooks/useGroupPeople';
import { settle, type PersonTotals } from '../lib/compute';
import { formatAmount, formatMoney, formatPercent } from '../lib/money';
import { recall, remember } from '../lib/deviceMemory';
import {
  buildDetailedText,
  buildSummaryText,
  copyText,
  personAmountText,
  receiptHeading,
} from '../lib/export';
import { personById } from '../lib/people';
import { tricountUrl, useTricountPush } from '../integrations/tricount/push';
import type { Receipt } from '../types';

type ResultsScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onHome: () => void;
};

/** `plats 47,95, remise −2,54, taxes 6,80, pourb. 8,18` */
function breakdownText(person: PersonTotals): string {
  const parts = [`plats ${formatAmount(person.linesCents)}`];
  if (person.adjustmentsCents !== 0) {
    parts.push(
      `${person.adjustmentsCents < 0 ? 'remise' : 'suppl.'} ${formatAmount(person.adjustmentsCents)}`,
    );
  }
  parts.push(`taxes ${formatAmount(person.taxesCents)}`);
  if (person.tipCents !== 0) parts.push(`pourb. ${formatAmount(person.tipCents)}`);
  return parts.join(', ');
}

/** Étape 3 — Envoi : la part de chacun, le payeur, puis l'envoi vers Tricount. */
export function ResultsScreen({ receipt, onBack, onHome }: ResultsScreenProps) {
  const people = useGroupPeople();
  const group = useAppStore((s) => s.group);
  const online = useAppStore((s) => s.online);
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /* The payer is remembered for this receipt on this device: leaving the
     screen and coming back must not ask again. */
  const [payer, setPayerState] = useState<string | null>(() => recall(receipt.id).payer ?? null);
  const setPayer = (id: string) => {
    remember(receipt.id, { payer: id });
    setPayerState(id);
  };
  const [payerOpen, setPayerOpen] = useState(false);
  /** The payer sheet was opened by "send": picking someone sends right after. */
  const [sendAfterPayer, setSendAfterPayer] = useState(false);
  const [confirmResend, setConfirmResend] = useState<string | null>(null);

  const settlement = useMemo(() => settle(receipt, people), [receipt, people]);
  const heading = receiptHeading(receipt, group?.title);
  const push = useTricountPush(receipt, settlement);

  const involved = settlement.people.filter(
    (person) => person.totalCents !== 0 || person.lineCount > 0,
  );
  const payerPerson = payer ? personById(people, payer) : undefined;

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
  };

  const copySummary = async () => {
    const ok = await copyText(buildSummaryText(receipt, settlement, people));
    if (ok) flash('summary');
  };

  const copyDetail = async () => {
    const ok = await copyText(buildDetailedText(receipt, settlement, people));
    if (ok) flash('detail');
  };

  const formatSentAt = (iso: string) =>
    new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

  /* Tricount has no "is this already there?": this device remembers what it
     sent, and asks before a second expense is created. */
  const sendAs = (payerId: string) => {
    if (push.lastSent) {
      setConfirmResend(payerId);
      return;
    }
    void push.send(payerId);
  };

  const send = () => {
    if (!payerPerson) {
      setSendAfterPayer(true);
      setPayerOpen(true);
      return;
    }
    sendAs(payerPerson.id);
  };

  const resendIsSame =
    push.lastSent !== null && confirmResend !== null
      ? push.lastSent.fingerprint === push.fingerprint(confirmResend)
      : false;

  const menu: MenuItem[] = [
    { label: copied === 'detail' ? 'Détail copié ✓' : 'Copier le détail', onSelect: () => void copyDetail() },
    {
      label: receipt.status === 'settled' ? 'Rouvrir le ticket' : 'Marquer comme réglé',
      onSelect: () => {
        updateReceipt({ status: receipt.status === 'settled' ? 'draft' : 'settled' });
        if (receipt.status !== 'settled') onHome();
      },
    },
  ];

  const busy = push.status.kind === 'busy';

  return (
    <Screen
      title={heading.title}
      subtitle={heading.subtitle}
      onBack={onBack}
      action={<MenuButton items={menu} />}
      step={3}
      banner={
        push.status.kind === 'failed' || settlement.unassignedLineIds.length > 0 ? (
          <>
            {push.status.kind === 'failed' ? (
              <Banner tone="warn" label="Envoi impossible">
                {push.status.message} Le récap reste copiable.
              </Banner>
            ) : null}
            {settlement.unassignedLineIds.length > 0 ? (
              <Banner tone="warn">
                {settlement.unassignedLineIds.length} ligne
                {settlement.unassignedLineIds.length > 1 ? 's' : ''} sans participant :{' '}
                <span className="num">{formatAmount(settlement.unassignedLinesCents)}</span> hors
                répartition
              </Banner>
            ) : null}
          </>
        ) : push.lastSent ? (
          <Banner label="Déjà envoyé">
            Envoyé à Tricount le {formatSentAt(push.lastSent.at)}.
          </Banner>
        ) : null
      }
      footer={
        <>
          <Button
            variant="primary"
            full
            disabled={busy || !online || push.shares.length === 0}
            onClick={send}
          >
            {busy ? 'Envoi…' : push.lastSent ? 'Renvoyer à Tricount' : 'Envoyer à Tricount'}
          </Button>
          <Button full onClick={() => void copySummary()}>
            {copied === 'summary' ? 'Récap copié ✓' : 'Copier le récap'}
          </Button>
        </>
      }
    >
      <ul className="payees">
        {involved.map((person) => {
          const identity = personById(people, person.personId);
          if (!identity) return null;
          const open = expanded === person.personId;
          return (
            <li key={person.personId} className="payee">
              <button
                type="button"
                className="payee__head"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : person.personId)}
              >
                <PersonPill person={identity} size="md" decorative />
                <span className="payee__main">
                  <span className="payee__name">{identity.name}</span>
                  <span className="payee__detail num">{breakdownText(person)}</span>
                </span>
                <span className="payee__amount num">{formatAmount(person.totalCents)}</span>
              </button>
              {open ? (
                <div className="payee__more">
                  <p className="muted">
                    {person.lineCount} plat{person.lineCount > 1 ? 's' : ''},{' '}
                    <span className="num">{formatPercent(person.ratio)}</span> du total
                    {person.soloLineCount > 0 ? (
                      <span className="results__count">
                        {' · '}
                        <ShareIcon count={1} decorative />
                        {person.soloLineCount} seul{person.soloLineCount > 1 ? 's' : ''}
                      </span>
                    ) : null}
                    {person.sharedLineCount > 0 ? (
                      <span className="results__count">
                        {' · '}
                        <ShareIcon count={2} decorative />
                        {person.sharedLineCount} partagé{person.sharedLineCount > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </p>
                  <ul className="results__detail">
                    {person.items.map((item, index) => (
                      <li key={`${item.id}-${index}`}>
                        <span className="results__item">
                          {item.kind === 'line' ? (
                            <ShareIcon count={item.shareCount} auto={item.auto} />
                          ) : (
                            <span className="shareIcon shareIcon--none" aria-hidden="true" />
                          )}
                          <span className="results__item-text">
                            {item.description?.trim() || item.label || 'Sans libellé'}
                          </span>
                          {item.kind === 'line' && item.shareCount > 1 ? (
                            <span className="results__shareCount num">÷{item.shareCount}</span>
                          ) : null}
                        </span>
                        <span className="num">{formatAmount(item.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="linkButton"
                    onClick={() => {
                      void copyText(personAmountText(person)).then((ok) => {
                        if (ok) flash(person.personId);
                      });
                    }}
                  >
                    {copied === person.personId ? 'Montant copié ✓' : `Copier le montant de ${identity.name}`}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        <li className="payee payee--total">
          <span className="payee__main payee__name--muted">Total</span>
          <span className="payee__amount num">{formatMoney(settlement.distributedTotalCents)}</span>
        </li>
      </ul>

      {settlement.autoSplitLineIds.length > 0 ? (
        <p className="muted">
          {settlement.autoSplitLineIds.length} plat
          {settlement.autoSplitLineIds.length > 1 ? 's' : ''} non attribué
          {settlement.autoSplitLineIds.length > 1 ? 's' : ''} (
          <span className="num">{formatAmount(settlement.autoSplitLinesCents)}</span>), partagé
          {settlement.autoSplitLineIds.length > 1 ? 's' : ''} entre les {people.length}{' '}
          participants.
        </p>
      ) : null}

      <button type="button" className="sec sec--row" onClick={() => setPayerOpen(true)}>
        <span className="sec__rowLabel">Payé par</span>
        <span className={`sec__rowValue${payerPerson ? '' : ' sec__rowValue--empty'}`}>
          {payerPerson ? payerPerson.name : 'À choisir'}
          <ChevronRight />
        </span>
      </button>

      <Sheet
        open={payerOpen}
        title="Qui a payé ?"
        onClose={() => {
          setPayerOpen(false);
          setSendAfterPayer(false);
        }}
      >
        <p className="muted">
          La dépense sera créée dans Tricount au nom de cette personne
          {sendAfterPayer ? ', et envoyée aussitôt.' : '.'}
        </p>
        <ul className="choices">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className={`choice${person.id === payer ? ' choice--on' : ''}`}
                aria-pressed={person.id === payer}
                onClick={() => {
                  setPayer(person.id);
                  setPayerOpen(false);
                  if (sendAfterPayer) {
                    setSendAfterPayer(false);
                    sendAs(person.id);
                  }
                }}
              >
                <PersonPill person={person} size="md" decorative />
                <span className="choice__name">{person.name}</span>
                {person.id === payer ? <span aria-hidden="true">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet
        open={confirmResend !== null}
        title="Déjà envoyé"
        onClose={() => setConfirmResend(null)}
        footer={
          <div className="row row--gap">
            <Button full onClick={() => setConfirmResend(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              full
              onClick={() => {
                const target = confirmResend;
                setConfirmResend(null);
                if (target) void push.send(target);
              }}
            >
              Renvoyer
            </Button>
          </div>
        }
      >
        {push.lastSent ? (
          <p className="muted">
            {resendIsSame
              ? `Cette dépense a déjà été envoyée le ${formatSentAt(push.lastSent.at)}. La renvoyer créerait un doublon dans Tricount.`
              : `Une version précédente de ce ticket a été envoyée le ${formatSentAt(push.lastSent.at)}. Elle reste dans Tricount : supprimez-la là-bas pour éviter un doublon.`}
          </p>
        ) : null}
      </Sheet>

      <Sheet
        open={push.status.kind === 'done'}
        title="Dépense envoyée"
        onClose={push.reset}
        footer={
          <div className="stack">
            <Button variant="primary" full onClick={onHome}>
              Terminer
            </Button>
            <Button full onClick={push.reset}>
              Revenir au récap
            </Button>
          </div>
        }
      >
        {push.status.kind === 'done' ? (
          <div className="sent">
            <span className="sent__amount num">{formatMoney(push.status.totalCents)}</span>
            <p className="muted">
              {heading.title}, payé par {personById(people, push.status.payer)?.name ?? '—'}. La
              dépense apparaît dans Tricount.
            </p>
            {receipt.groupId ? (
              <a
                className="linkButton"
                href={tricountUrl(receipt.groupId)}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir dans Tricount
              </a>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </Screen>
  );
}
