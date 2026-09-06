import { useMemo, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { AmountInput } from '../ui/AmountInput';
import { PersonPill } from '../ui/PersonPill';
import { ShareIcon } from '../ui/ShareIcon';
import { useAppStore } from '../store/useAppStore';
import { useGroupPeople } from '../hooks/useGroupPeople';
import { settle, tipForPercent } from '../lib/compute';
import { formatCents, formatPercent } from '../lib/money';
import { buildDetailedText, buildSummaryText, copyText, personAmountText } from '../lib/export';
import { personById } from '../lib/people';
import { TricountPanel } from '../integrations/tricount/TricountPanel';
import type { Receipt } from '../types';

type ResultsScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onHome: () => void;
};

export function ResultsScreen({ receipt, onBack, onHome }: ResultsScreenProps) {
  const people = useGroupPeople();
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const settings = useAppStore((s) => s.settings);
  const settlement = useMemo(() => settle(receipt, people), [receipt, people]);

  const tipChoices = useMemo(
    () => [...new Set([15, 18, 20, settings.defaultTipPercent])].filter((p) => p > 0).sort((a, b) => a - b),
    [settings.defaultTipPercent],
  );

  const setTipPercent = (percent: number) => {
    updateReceipt((current) => ({
      ...current,
      tipCents: tipForPercent(current, current.tipBasis, percent),
    }));
  };

  const activePercent = (percent: number) =>
    receipt.tipCents !== 0 &&
    receipt.tipCents === tipForPercent(receipt, receipt.tipBasis, percent);

  const involved = settlement.people.filter(
    (person) => person.totalCents !== 0 || person.lineCount > 0,
  );

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

  return (
    <Screen
      title="Résultats"
      onBack={onBack}
      banner={
        settlement.unassignedLineIds.length > 0 ? (
          <Banner tone="warn">
            {settlement.unassignedLineIds.length} ligne
            {settlement.unassignedLineIds.length > 1 ? 's' : ''} sans participant —{' '}
            <span className="num">{formatCents(settlement.unassignedLinesCents)}</span> hors
            répartition
          </Banner>
        ) : settlement.autoSplitLineIds.length > 0 ? (
          <Banner>
            {settlement.autoSplitLineIds.length} ligne
            {settlement.autoSplitLineIds.length > 1 ? 's' : ''} non attribuée
            {settlement.autoSplitLineIds.length > 1 ? 's' : ''} —{' '}
            <span className="num">{formatCents(settlement.autoSplitLinesCents)}</span> partagé
            {settlement.autoSplitLineIds.length > 1 ? 's' : ''} entre les{' '}
            {people.length} participants
          </Banner>
        ) : null
      }
      footer={
        <>
          <Button variant="primary" full onClick={() => void copySummary()}>
            {copied === 'summary' ? 'Copié ✓' : 'Copier le récapitulatif'}
          </Button>
          <div className="row row--gap">
            <Button full onClick={() => void copyDetail()}>
              {copied === 'detail' ? 'Copié ✓' : 'Copier le détail'}
            </Button>
            <Button
              full
              onClick={() => {
                updateReceipt({
                  status: receipt.status === 'settled' ? 'draft' : 'settled',
                });
                if (receipt.status !== 'settled') onHome();
              }}
            >
              {receipt.status === 'settled' ? 'Rouvrir' : 'Marquer comme réglé'}
            </Button>
          </div>
        </>
      }
    >
      <ul className="results">
        {involved.map((person) => {
          const identity = personById(people, person.personId);
          if (!identity) return null;
          const open = expanded === person.personId;
          return (
            <li key={person.personId} className="results__row">
              <div className="results__head">
                <PersonPill person={identity} size="sm" />
                <button
                  type="button"
                  className="results__name"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : person.personId)}
                >
                  {identity.name}
                </button>
                <span className="results__amount num">{formatCents(person.totalCents)}</span>
                <button
                  type="button"
                  className="iconButton iconButton--quiet"
                  aria-label={`Copier le montant de ${identity.name}`}
                  onClick={() => {
                    void copyText(personAmountText(person)).then((ok) => {
                      if (ok) flash(person.personId);
                    });
                  }}
                >
                  {copied === person.personId ? '✓' : '⧉'}
                </button>
              </div>
              <div className="results__meta">
                <span>
                  dont taxes <span className="num">{formatCents(person.taxesCents)}</span>
                </span>
                {person.tipCents !== 0 ? (
                  <span>
                    pourboire <span className="num">{formatCents(person.tipCents)}</span>
                  </span>
                ) : null}
                <span>
                  {person.lineCount} article{person.lineCount > 1 ? 's' : ''} ·{' '}
                  <span className="num">{formatPercent(person.ratio)}</span> du total
                </span>
                {person.soloLineCount > 0 ? (
                  <span className="results__count">
                    <ShareIcon count={1} decorative />
                    {person.soloLineCount} seul{person.soloLineCount > 1 ? 's' : ''}
                  </span>
                ) : null}
                {person.sharedLineCount > 0 ? (
                  <span className="results__count">
                    <ShareIcon count={2} decorative />
                    {person.sharedLineCount} partagé{person.sharedLineCount > 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
              {open ? (
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
                          {item.description && item.description.trim() !== item.label.trim() ? (
                            <span className="results__item-code muted"> ({item.label})</span>
                          ) : null}
                        </span>
                        {item.kind === 'line' && item.shareCount > 1 ? (
                          <span className="results__shareCount num">÷{item.shareCount}</span>
                        ) : null}
                      </span>
                      <span className="num">{formatCents(item.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="results__total">
        <span>Total</span>
        <span className="num">{formatCents(settlement.distributedTotalCents)}</span>
      </div>

      <section className="section">
        <div className="row row--between">
          <h2>Pourboire</h2>
          <span className="num">{formatCents(settlement.tipCents)}</span>
        </div>
        <div className="row row--gap">
          {tipChoices.map((percent) => (
            <Button
              key={percent}
              full
              variant={activePercent(percent) ? 'primary' : 'secondary'}
              onClick={() => setTipPercent(percent)}
            >
              {percent} %
            </Button>
          ))}
          <Button
            full
            variant={receipt.tipCents === 0 ? 'primary' : 'secondary'}
            onClick={() => updateReceipt({ tipCents: 0 })}
          >
            Aucun
          </Button>
        </div>
        <div className="row row--gap">
          <label className="field field--grow">
            <span className="field__label">Montant libre</span>
            <AmountInput
              valueCents={receipt.tipCents}
              onChange={(cents) => updateReceipt({ tipCents: cents ?? 0 })}
              aria-label="Montant du pourboire"
            />
          </label>
          <label className="field field--grow">
            <span className="field__label">Calculé sur</span>
            <select
              value={receipt.tipBasis}
              aria-label="Base de calcul du pourboire"
              onChange={(event) => {
                const tipBasis = event.target.value as typeof receipt.tipBasis;
                updateReceipt((current) => ({ ...current, tipBasis }));
              }}
            >
              <option value="subtotal">le sous-total avant taxes</option>
              <option value="total">le total, taxes comprises</option>
            </select>
          </label>
        </div>
        <p className="muted">
          Le pourboire ne figure pas sur le ticket : il s’ajoute au total réparti sans entrer
          dans le contrôle du montant imprimé.
        </p>
      </section>

      <TricountPanel receipt={receipt} settlement={settlement} />
    </Screen>
  );
}
