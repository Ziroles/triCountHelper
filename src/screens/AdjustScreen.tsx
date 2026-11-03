import { useMemo, useReducer, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { AmountInput } from '../ui/AmountInput';
import { PercentInput } from '../ui/PercentInput';
import { Segmented } from '../ui/Segmented';
import { useAppStore } from '../store/useAppStore';
import { useGroupPeople } from '../hooks/useGroupPeople';
import { appliesTo, settle, tipForPercent } from '../lib/compute';
import { recall, remember } from '../lib/deviceMemory';
import { remainingDishes, type DishSplit } from '../lib/reconcile';
import { formatAmount, formatMoney, roundHalfUp } from '../lib/money';
import { receiptHeading } from '../lib/export';
import { personById } from '../lib/people';
import { uid } from '../lib/id';
import { lineTitle } from './AssignScreen';
import {
  regimeByCode,
  type Adjustment,
  type Receipt,
  type ReceiptLine,
  type ReceiptTax,
  type TipBasis,
} from '../types';

type AdjustScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onEditLines: () => void;
  onDone: () => void;
};

type TipChoice = `${number}` | 'other';
type TipUnit = 'percent' | 'amount';
type DiscountMode = 'proportional' | 'dishes';

function formatRate(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return `${String(rate).replace('.', ',')} %`;
}

/**
 * Étape 2 — Ajustements : taxes, remises, pourboire, et le contrôle du total.
 * Tout ce qui s'ajoute aux plats est regroupé ici, avant le récapitulatif.
 */
export function AdjustScreen({ receipt, onBack, onEditLines, onDone }: AdjustScreenProps) {
  const people = useGroupPeople();
  const group = useAppStore((s) => s.group);
  const settings = useAppStore((s) => s.settings);
  const updateReceipt = useAppStore((s) => s.updateReceipt);

  const [taxFor, setTaxFor] = useState<string | null>(null);
  const [adjustmentFor, setAdjustmentFor] = useState<string | 'new' | null>(null);
  const [dishesFor, setDishesFor] = useState<string | null>(null);
  /* « Autre » opened by hand, and in which unit; null follows what is stored. */
  const [otherUnit, setOtherUnit] = useState<TipUnit | null>(null);

  /* What this device remembers of the user's intentions (see deviceMemory).
     It is not React state: `note` writes it, then re-renders. */
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const memory = recall(receipt.id);
  const note = (patch: Parameters<typeof remember>[1]) => {
    remember(receipt.id, patch);
    rerender();
  };

  const settlement = useMemo(() => settle(receipt, people), [receipt, people]);
  const heading = receiptHeading(receipt, group?.title);
  const regime = regimeByCode(settings.taxRegimeCode);

  // ── Taxes ──────────────────────────────────────────────────────────────────
  const addRegimeTaxes = () => {
    /* The rate is known: we prefill the amount on the taxable dishes. It stays
       a suggestion — the amount printed on the receipt is the one that counts,
       and the section says these were computed, not read. */
    const taxes = regime.taxes.map((tax) => ({ ...tax, id: uid() }));
    note({ computedTaxes: taxes.map((tax) => tax.id) });
    updateReceipt((current) => ({
      ...current,
      taxes: taxes.map((tax) => {
        const created: ReceiptTax = {
          id: tax.id,
          code: tax.code,
          label: tax.label,
          ratePercent: tax.ratePercent,
          amountCents: 0,
        };
        const base = current.lines
          .filter((line) => appliesTo(line, created))
          .reduce((sum, line) => sum + line.totalCents, 0);
        return { ...created, amountCents: roundHalfUp((base * tax.ratePercent) / 100) };
      }),
    }));
  };

  const forgetComputed = (id: string) => {
    if (memory.computedTaxes?.includes(id)) {
      note({ computedTaxes: memory.computedTaxes.filter((value) => value !== id) });
    }
  };

  const patchTax = (id: string, patch: Partial<ReceiptTax>) => {
    // An amount typed by hand is the one from the receipt: no longer computed.
    if (patch.amountCents !== undefined) forgetComputed(id);
    updateReceipt((current) => ({
      ...current,
      taxes: current.taxes.map((tax) => (tax.id === id ? { ...tax, ...patch } : tax)),
    }));
  };

  const removeTax = (id: string) => {
    forgetComputed(id);
    updateReceipt((current) => ({
      ...current,
      taxes: current.taxes.filter((tax) => tax.id !== id),
    }));
  };

  const computedCount = receipt.taxes.filter((tax) =>
    memory.computedTaxes?.includes(tax.id),
  ).length;
  const taxesNote =
    computedCount === receipt.taxes.length
      ? 'calculées sur le taux'
      : computedCount > 0
        ? 'en partie calculées'
        : receipt.imageId
          ? 'lues sur le ticket'
          : formatAmount(settlement.taxesTotalCents);

  // ── Remises ────────────────────────────────────────────────────────────────
  const patchAdjustment = (id: string, patch: Partial<Adjustment>) =>
    updateReceipt((current) => ({
      ...current,
      adjustments: current.adjustments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));

  /* Legacy: the dishes of a discount chosen before the API kept them. */
  const forgetDishes = (id: string) => {
    if (!memory.dishes?.[id] && !memory.dishSplit?.[id]) return;
    const without = <T,>(record: Record<string, T> | undefined) =>
      record ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== id)) : undefined;
    note({ dishes: without(memory.dishes), dishSplit: without(memory.dishSplit) });
  };

  const removeAdjustment = (id: string) => {
    forgetDishes(id);
    updateReceipt((current) => ({
      ...current,
      adjustments: current.adjustments.filter((a) => a.id !== id),
    }));
  };

  const stated = receipt.statedTotalCents;
  const gap = stated === null ? 0 : settlement.receiptTotalCents - stated;

  const absorbGap = () => {
    if (gap === 0) return;
    updateReceipt((current) => ({
      ...current,
      adjustments: [
        ...current.adjustments,
        {
          id: uid(),
          label: 'Écart de saisie',
          amountCents: -gap,
          mode: 'proportional',
          assignments: [],
        },
      ],
    }));
  };

  // ── Pourboire ──────────────────────────────────────────────────────────────
  const tipPercents = useMemo(
    () =>
      [...new Set([15, 18, 20, settings.defaultTipPercent])]
        .filter((p) => p > 0)
        .sort((a, b) => a - b),
    [settings.defaultTipPercent],
  );

  const matchingPercent = (basis: TipBasis) =>
    receipt.tipCents === 0
      ? null
      : (tipPercents.find((p) => receipt.tipCents === tipForPercent(receipt, basis, p)) ?? null);

  /* A percentage picked on this device — offered or typed — is followed even
     when the base moves (see reconcile); elsewhere, the stored amount is
     matched back to an offered rate, or shown as an amount under « Autre ». */
  const remembered = memory.tipPercent;
  const presetPercent =
    otherUnit !== null
      ? null
      : remembered !== undefined
        ? tipPercents.includes(remembered)
          ? remembered
          : null
        : matchingPercent(receipt.tipBasis);
  const tipChoice: TipChoice | null =
    presetPercent !== null
      ? (`${presetPercent}` as TipChoice)
      : otherUnit !== null || remembered !== undefined || receipt.tipCents !== 0
        ? 'other'
        : null;
  const tipUnit: TipUnit = otherUnit ?? (remembered !== undefined ? 'percent' : 'amount');
  const activePercent =
    presetPercent ?? (tipChoice === 'other' && tipUnit === 'percent' ? (remembered ?? null) : null);

  const applyPercent = (percent: number) => {
    note({ tipPercent: percent });
    updateReceipt((current) => ({
      ...current,
      tipCents: tipForPercent(current, current.tipBasis, percent),
    }));
  };

  const chooseTip = (choice: TipChoice) => {
    if (choice === 'other') {
      // The amount does not move: only the way to type it opens.
      setOtherUnit(remembered !== undefined || receipt.tipCents === 0 ? 'percent' : 'amount');
      return;
    }
    setOtherUnit(null);
    applyPercent(Number(choice));
  };

  const chooseUnit = (unit: TipUnit) => {
    setOtherUnit(unit);
    // An amount is fixed: it no longer follows the base.
    if (unit === 'amount') note({ tipPercent: undefined });
  };

  const chooseBasis = (tipBasis: TipBasis) => {
    // A percentage stays a percentage: switching the base recomputes it.
    const percent = activePercent;
    updateReceipt((current) => ({
      ...current,
      tipBasis,
      tipCents: percent === null ? current.tipCents : tipForPercent(current, tipBasis, percent),
    }));
  };

  const taxSheet = receipt.taxes.find((tax) => tax.id === taxFor) ?? null;
  const adjustmentSheet =
    adjustmentFor === 'new'
      ? 'new'
      : (receipt.adjustments.find((a) => a.id === adjustmentFor) ?? null);
  const dishesSheet = receipt.adjustments.find((a) => a.id === dishesFor) ?? null;

  return (
    <Screen
      title={heading.title}
      subtitle={heading.subtitle}
      onBack={onBack}
      step={2}
      footer={
        <Button variant="primary" full onClick={onDone}>
          Continuer
        </Button>
      }
    >
      <div className="grandTotal">
        <div className="grandTotal__main">
          <span className="grandTotal__label">Total à répartir</span>
          <span className="grandTotal__value num">{formatMoney(settlement.distributedTotalCents)}</span>
        </div>
        <span className="grandTotal__aside num">plats {formatAmount(settlement.subtotalCents)}</span>
      </div>

      <section className="sec" aria-labelledby="sec-taxes">
        <div className="sec__head">
          <h2 id="sec-taxes">Taxes</h2>
          {receipt.taxes.length === 0 ? (
            <button type="button" className="sec__link" onClick={addRegimeTaxes}>
              + {regime.label}
            </button>
          ) : (
            <small>{taxesNote}</small>
          )}
        </div>
        {receipt.taxes.length === 0 ? (
          <p className="sec__note">
            Aucune taxe. Les prix des plats sont hors taxes : ajoutez celles du ticket.
          </p>
        ) : (
          receipt.taxes.map((tax) => (
            <button
              key={tax.id}
              type="button"
              className="sec__line sec__line--button"
              onClick={() => setTaxFor(tax.id)}
            >
              <span>
                {tax.label}
                {formatRate(tax.ratePercent) ? ` ${formatRate(tax.ratePercent)}` : ''}
              </span>
              <span className="num">{formatAmount(tax.amountCents)}</span>
            </button>
          ))
        )}
      </section>

      <section className="sec" aria-labelledby="sec-remise">
        <div className="sec__head">
          <h2 id="sec-remise">Remise</h2>
          <button type="button" className="sec__link" onClick={() => setAdjustmentFor('new')}>
            Ajouter
          </button>
        </div>
        {receipt.adjustments.length === 0 ? (
          <p className="sec__note">Aucune remise.</p>
        ) : (
          receipt.adjustments.map((adjustment) => {
            const mode: DiscountMode = adjustment.mode === 'proportional' ? 'proportional' : 'dishes';
            /* Who bears it, as computed: a discount on some dishes follows
               who has them, on every device. */
            const targets = settlement.people
              .filter((entry) =>
                entry.items.some((item) => item.kind === 'adjustment' && item.id === adjustment.id),
              )
              .map((entry) => personById(people, entry.personId)?.name)
              .filter(Boolean)
              .join(', ');
            const equal = adjustment.split === 'equal';
            const dishes =
              adjustment.mode === 'lines' ? remainingDishes(receipt, adjustment.lineIds) : [];
            /* Its dishes deleted since, or chosen on a device that has not
               handed them over yet: the user must know the split no longer
               follows the dishes. */
            const dishesNote =
              adjustment.mode === 'assigned'
                ? 'plats choisis sur un autre appareil : à refaire s’ils ont changé'
                : adjustment.mode === 'lines' && dishes.length === 0
                  ? 'les plats choisis n’existent plus : répartie au prorata, choisissez-les à nouveau'
                  : null;
            return (
              <div key={adjustment.id} className="sec__group">
                <button
                  type="button"
                  className="sec__line sec__line--button"
                  onClick={() => setAdjustmentFor(adjustment.id)}
                >
                  <span>
                    {adjustment.label}
                    {mode === 'dishes' && targets ? (
                      <small className="sec__sub">
                        {dishes.length > 0
                          ? `sur ${dishes.length} plat${dishes.length > 1 ? 's' : ''}${equal ? ', à parts égales' : ''}, pour ${targets}`
                          : `pour ${targets}`}
                      </small>
                    ) : null}
                    {dishesNote ? (
                      <small className="sec__sub sec__sub--warn">{dishesNote}</small>
                    ) : null}
                  </span>
                  <span
                    className={`num${adjustment.amountCents < 0 ? ' discount' : ''}`}
                  >
                    {adjustment.amountCents > 0 ? '+' : ''}
                    {formatAmount(adjustment.amountCents)}
                  </span>
                </button>
                <Segmented<DiscountMode>
                  label={`Répartition de ${adjustment.label}`}
                  options={[
                    { value: 'proportional', label: 'Au prorata' },
                    { value: 'dishes', label: 'Sur des plats' },
                  ]}
                  value={mode}
                  onChange={(next) => {
                    if (next === 'dishes') {
                      setDishesFor(adjustment.id);
                      return;
                    }
                    forgetDishes(adjustment.id);
                    patchAdjustment(adjustment.id, {
                      mode: 'proportional',
                      assignments: [],
                      lineIds: undefined,
                      split: undefined,
                    });
                  }}
                />
              </div>
            );
          })
        )}
      </section>

      <section className="sec" aria-labelledby="sec-tip">
        <div className="sec__head">
          <h2 id="sec-tip">Pourboire</h2>
          <span className="sec__amount num">{formatAmount(settlement.tipCents)}</span>
        </div>
        <Segmented<TipChoice>
          label="Pourboire"
          options={[
            ...tipPercents.map((p) => ({ value: `${p}` as TipChoice, label: `${p} %` })),
            { value: 'other', label: 'Autre' },
          ]}
          value={tipChoice}
          onChange={chooseTip}
        />
        {tipChoice === 'other' ? (
          <div className="tipOther">
            {tipUnit === 'percent' ? (
              <PercentInput
                value={remembered ?? null}
                onChange={(percent) => {
                  if (percent === null) {
                    note({ tipPercent: undefined });
                    updateReceipt({ tipCents: 0 });
                    return;
                  }
                  applyPercent(percent);
                }}
                aria-label="Taux du pourboire"
              />
            ) : (
              <AmountInput
                valueCents={receipt.tipCents}
                onChange={(cents) => {
                  note({ tipPercent: undefined });
                  updateReceipt({ tipCents: cents ?? 0 });
                }}
                aria-label="Montant du pourboire"
              />
            )}
            <Segmented<TipUnit>
              label="Unité du pourboire"
              options={[
                { value: 'percent', label: '%' },
                { value: 'amount', label: '$' },
              ]}
              value={tipUnit}
              onChange={chooseUnit}
            />
          </div>
        ) : null}
        <Segmented<TipBasis>
          label="Base du pourboire"
          options={[
            { value: 'subtotal', label: 'Avant taxes' },
            { value: 'total', label: 'Après taxes' },
          ]}
          value={receipt.tipBasis}
          onChange={chooseBasis}
        />
      </section>

      {stated !== null ? (
        <section className="sec" role="group" aria-label="Contrôle du total">
          <div className="sec__head">
            <h2>Autres</h2>
            <small>total lu {formatAmount(stated)}</small>
          </div>
          {gap === 0 ? (
            <div className="sec__line">
              <span>Le total du ticket concorde</span>
              <span aria-hidden="true">✓</span>
            </div>
          ) : (
            <>
              <div className="sec__line">
                <span>Écart avec le ticket</span>
                <span className="num">{formatAmount(-gap)}</span>
              </div>
              <div className="sec__actions">
                <button type="button" className="linkButton" onClick={absorbGap}>
                  Ajouter en ajustement
                </button>
                <button type="button" className="linkButton" onClick={onEditLines}>
                  Corriger les lignes
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <TaxSheet
        tax={taxSheet}
        onClose={() => setTaxFor(null)}
        onChange={(patch) => taxSheet && patchTax(taxSheet.id, patch)}
        onRemove={() => {
          if (taxSheet) removeTax(taxSheet.id);
          setTaxFor(null);
        }}
      />

      <AdjustmentSheet
        adjustment={adjustmentSheet}
        onClose={() => setAdjustmentFor(null)}
        onSave={(saved) => {
          updateReceipt((current) => ({
            ...current,
            adjustments: current.adjustments.some((a) => a.id === saved.id)
              ? current.adjustments.map((a) => (a.id === saved.id ? saved : a))
              : [...current.adjustments, saved],
          }));
          setAdjustmentFor(null);
        }}
        onRemove={(id) => {
          removeAdjustment(id);
          setAdjustmentFor(null);
        }}
      />

      <DishesSheet
        adjustment={dishesSheet}
        lines={receipt.lines}
        initial={dishesSheet ? remainingDishes(receipt, dishesSheet.lineIds).map((l) => l.id) : []}
        initialSplit={dishesSheet?.split ?? 'prorata'}
        canSplit={people.length > 0}
        onClose={() => setDishesFor(null)}
        onApply={(lines, split) => {
          if (!dishesSheet || lines.length === 0 || people.length === 0) return;
          forgetDishes(dishesSheet.id);
          patchAdjustment(dishesSheet.id, {
            mode: 'lines',
            assignments: [],
            lineIds: lines.map((line) => line.id),
            split,
          });
          setDishesFor(null);
        }}
      />
    </Screen>
  );
}

// ── Feuilles ─────────────────────────────────────────────────────────────────

type TaxSheetProps = {
  tax: ReceiptTax | null;
  onClose: () => void;
  onChange: (patch: Partial<ReceiptTax>) => void;
  onRemove: () => void;
};

function TaxSheet({ tax, onClose, onChange, onRemove }: TaxSheetProps) {
  if (!tax) return null;
  return (
    <Sheet
      open
      title={tax.label || 'Taxe'}
      onClose={onClose}
      footer={
        <div className="row row--gap">
          <Button variant="danger" full onClick={onRemove}>
            Retirer cette taxe
          </Button>
          <Button variant="primary" full onClick={onClose}>
            Terminé
          </Button>
        </div>
      }
    >
      <label className="field">
        <span className="field__label">Nom</span>
        <input
          type="text"
          value={tax.label}
          aria-label="Nom de la taxe"
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">Montant</span>
        <AmountInput
          valueCents={tax.amountCents}
          onChange={(cents) => onChange({ amountCents: cents ?? 0 })}
          allowNegative
          aria-label={`Montant de ${tax.label}`}
        />
      </label>
    </Sheet>
  );
}

type AdjustmentSheetProps = {
  adjustment: Adjustment | 'new' | null;
  onClose: () => void;
  onSave: (adjustment: Adjustment) => void;
  onRemove: (id: string) => void;
};

function AdjustmentSheet({ adjustment, onClose, onSave, onRemove }: AdjustmentSheetProps) {
  if (adjustment === null) return null;
  return (
    <AdjustmentForm
      key={adjustment === 'new' ? 'new' : adjustment.id}
      adjustment={adjustment === 'new' ? null : adjustment}
      onClose={onClose}
      onSave={onSave}
      onRemove={onRemove}
    />
  );
}

function AdjustmentForm({
  adjustment,
  onClose,
  onSave,
  onRemove,
}: {
  adjustment: Adjustment | null;
  onClose: () => void;
  onSave: (adjustment: Adjustment) => void;
  onRemove: (id: string) => void;
}) {
  const [label, setLabel] = useState(adjustment?.label ?? '');
  const [amount, setAmount] = useState(Math.abs(adjustment?.amountCents ?? 0));
  const [negative, setNegative] = useState((adjustment?.amountCents ?? -1) <= 0);

  const save = () => {
    const signed = negative ? -Math.abs(amount) : Math.abs(amount);
    onSave({
      ...adjustment,
      id: adjustment?.id ?? uid(),
      label: label.trim() || (negative ? 'Remise' : 'Supplément'),
      amountCents: signed,
      mode: adjustment?.mode ?? 'proportional',
      assignments: adjustment?.assignments ?? [],
    });
  };

  return (
    <Sheet
      open
      title={adjustment ? 'Modifier la remise' : 'Ajouter une remise'}
      onClose={onClose}
      footer={
        <div className="row row--gap">
          {adjustment ? (
            <Button variant="danger" full onClick={() => onRemove(adjustment.id)}>
              Supprimer
            </Button>
          ) : null}
          <Button variant="primary" full disabled={amount === 0} onClick={save}>
            {adjustment ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      }
    >
      <label className="field">
        <span className="field__label">Libellé</span>
        <input
          type="text"
          value={label}
          placeholder="Rabais fidélité, sac, arrondi de caisse…"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Montant</span>
        <AmountInput
          valueCents={amount}
          onChange={(cents) => setAmount(Math.abs(cents ?? 0))}
          aria-label="Montant"
        />
      </label>
      <Segmented<'minus' | 'plus'>
        label="Sens"
        options={[
          { value: 'minus', label: 'Remise (−)' },
          { value: 'plus', label: 'Supplément (+)' },
        ]}
        value={negative ? 'minus' : 'plus'}
        onChange={(value) => setNegative(value === 'minus')}
      />
    </Sheet>
  );
}

type DishesSheetProps = {
  adjustment: Adjustment | null;
  lines: ReceiptLine[];
  /** Dishes already chosen for this discount, on this device. */
  initial: string[];
  initialSplit: DishSplit;
  /** False when the group has nobody to give the discount to. */
  canSplit: boolean;
  onClose: () => void;
  onApply: (lines: ReceiptLine[], split: DishSplit) => void;
};

function DishesSheet(props: DishesSheetProps) {
  if (!props.adjustment) return null;
  return <DishesPicker key={props.adjustment.id} {...props} adjustment={props.adjustment} />;
}

function DishesPicker({
  adjustment,
  lines,
  initial,
  initialSplit,
  canSplit,
  onClose,
  onApply,
}: DishesSheetProps & { adjustment: Adjustment }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [split, setSplit] = useState<DishSplit>(initialSplit);
  const chosen = lines.filter((line) => picked.includes(line.id));

  return (
    <Sheet
      open
      title={`${adjustment.label} : sur quels plats ?`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          full
          disabled={chosen.length === 0 || !canSplit}
          onClick={() => onApply(chosen, split)}
        >
          Appliquer
        </Button>
      }
    >
      <Segmented<DishSplit>
        label="Partage de la remise"
        options={[
          { value: 'prorata', label: 'Au prorata' },
          { value: 'equal', label: 'À parts égales' },
        ]}
        value={split}
        onChange={setSplit}
      />
      <p className="muted">
        {split === 'equal'
          ? 'La remise est partagée à parts égales entre les personnes de ces plats.'
          : 'La remise est répartie entre les personnes de ces plats, au prorata de leur part.'}{' '}
        Elle suit les plats si vous changez ensuite qui a pris quoi.
      </p>
      {!canSplit ? (
        <p className="warnText">
          Ce groupe n’a aucun participant : il n’y a personne à qui appliquer la remise.
        </p>
      ) : null}
      <ul className="shares">
        {lines.map((line) => (
          <li key={line.id}>
            <label className="shares__row">
              <input
                type="checkbox"
                checked={picked.includes(line.id)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked
                      ? [...current, line.id]
                      : current.filter((id) => id !== line.id),
                  )
                }
              />
              <span className="shares__name">{lineTitle(line)}</span>
              <span className="shares__amount num">{formatAmount(line.totalCents)}</span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

