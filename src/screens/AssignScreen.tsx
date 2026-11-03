import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { Sheet } from '../ui/Sheet';
import { PersonPill, PillStack } from '../ui/PersonPill';
import { SplitBar } from '../ui/SplitBar';
import { MenuButton, type MenuItem } from '../ui/MenuSheet';
import { PhotoSheet } from '../ui/PhotoSheet';
import { AmountInput } from '../ui/AmountInput';
import { Segmented } from '../ui/Segmented';
import type { DishSplit } from '../lib/reconcile';
import { uid } from '../lib/id';
import { useAppStore } from '../store/useAppStore';
import { useGroupPeople } from '../hooks/useGroupPeople';
import { useReceiptImage } from '../hooks/useReceiptImage';
import { useLongPress } from '../hooks/useLongPress';
import { settle } from '../lib/compute';
import { formatAmount } from '../lib/money';
import { splitCents } from '../lib/split';
import { personById } from '../lib/people';
import { receiptHeading } from '../lib/export';
import type { Adjustment, Assignment, Person, Receipt, ReceiptLine } from '../types';

type AssignScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  /** Open the line editor (labels, prices, quantities). */
  onEditLines: () => void;
  /** Back to the photo, to frame or read it again. */
  onRetakePhoto?: (() => void) | undefined;
  onDone: () => void;
};

/** Name of a dish, then what the receipt printed when it differs. */
export function lineTitle(line: ReceiptLine): string {
  return line.description?.trim() || line.label || 'Sans libellé';
}

function lineCaption(line: ReceiptLine): string | null {
  const parts: string[] = [];
  if (line.quantity > 1) parts.push(`${line.quantity} × ${formatAmount(line.unitPriceCents)}`);
  if (line.description && line.description.trim() !== line.label.trim() && line.label.trim()) {
    parts.push(line.label.trim());
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Étape 1 — Plats.
 *
 * On choisit un convive en haut, puis on touche les plats : un plat qu'il n'a
 * pas lui est ajouté (en partage s'il est déjà à d'autres), un plat qu'il a lui
 * est retiré. Les totaux affichés sont les totaux finaux — taxes, remises et
 * pourboire compris — et bougent à chaque toucher.
 */
export function AssignScreen({
  receipt,
  onBack,
  onEditLines,
  onRetakePhoto,
  onDone,
}: AssignScreenProps) {
  /* The participants are the tricount's members: there is nobody left to add
     here. Someone missing gets added in Tricount, then picked up via "Refresh"
     on the group screen — that is where the list is authoritative. */
  const people = useGroupPeople();
  const group = useAppStore((s) => s.group);
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const imageUrl = useReceiptImage(receipt.id, receipt.imageId);

  const [selected, setSelected] = useState<string | null>(null);
  const [sharesFor, setSharesFor] = useState<string | null>(null);
  const [confirmUnassigned, setConfirmUnassigned] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [discountFor, setDiscountFor] = useState<string | null>(null);

  /* Each dish shows the discounts that apply to it. */
  const discountsOn = (lineId: string): Adjustment[] =>
    receipt.adjustments.filter(
      (adjustment) => adjustment.mode === 'lines' && adjustment.lineIds?.includes(lineId),
    );

  const addDishDiscount = (line: ReceiptLine, amountCents: number, label: string, split: DishSplit) => {
    if (people.length === 0) return;
    updateReceipt((current) => ({
      ...current,
      adjustments: [
        ...current.adjustments,
        {
          id: uid(),
          label,
          amountCents: -Math.abs(amountCents),
          mode: 'lines',
          assignments: [],
          lineIds: [line.id],
          split,
        },
      ],
    }));
  };

  const settlement = useMemo(() => settle(receipt, people), [receipt, people]);
  const heading = receiptHeading(receipt, group?.title);

  const unassigned = useMemo(
    () => receipt.lines.filter((line) => line.assignments.length === 0),
    [receipt.lines],
  );

  /* The members arrive from the network: we preselect the first one as soon as
     they are there, so the screen is usable without a preliminary gesture. */
  const primed = useRef(false);
  useEffect(() => {
    if (primed.current || people.length === 0) return;
    primed.current = true;
    setSelected(people[0]!.id);
  }, [people]);

  const selectedPerson = selected ? personById(people, selected) : undefined;

  const setAssignments = (lineId: string, assignments: Assignment[]) => {
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.map((item) => (item.id === lineId ? { ...item, assignments } : item)),
    }));
  };

  const toggleOnLine = (line: ReceiptLine) => {
    if (!selected) return;
    const has = line.assignments.some((a) => a.personId === selected);
    setAssignments(
      line.id,
      has
        ? line.assignments.filter((a) => a.personId !== selected)
        : [...line.assignments, { personId: selected, shares: 1 }],
    );
  };

  const assignAll = (assignments: Assignment[]) => {
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.map((line) => ({ ...line, assignments: [...assignments] })),
    }));
  };

  const totalOf = (personId: string) =>
    settlement.people.find((entry) => entry.personId === personId)?.totalCents ?? 0;

  const sharesLine = receipt.lines.find((line) => line.id === sharesFor) ?? null;

  const menu: MenuItem[] = [
    { label: 'Corriger les lignes du ticket', onSelect: onEditLines },
    ...(receipt.imageId ? [{ label: 'Voir la photo', onSelect: () => setPhotoOpen(true) }] : []),
    ...(onRetakePhoto ? [{ label: 'Reprendre la photo', onSelect: onRetakePhoto }] : []),
  ];

  return (
    <Screen
      title={heading.title}
      subtitle={heading.subtitle}
      onBack={onBack}
      action={<MenuButton items={menu} />}
      step={1}
      banner={
        people.length === 0 ? (
          <Banner tone="warn" label="Aucun participant">
            Ce tricount n’a aucun participant. Ajoutez-en dans Tricount, puis rafraîchissez
            depuis l’écran du groupe.
          </Banner>
        ) : null
      }
      footer={
        <Button
          variant="primary"
          full
          disabled={receipt.lines.length === 0}
          onClick={() =>
            unassigned.length > 0 && people.length === 0 ? setConfirmUnassigned(true) : onDone()
          }
        >
          Continuer
        </Button>
      }
    >
      {people.length > 0 ? (
        <div className="diners">
          <div className={`diners__row${people.length > 4 ? ' diners__row--scroll' : ''}`}>
            {people.map((person) => {
              const on = person.id === selected;
              return (
                <button
                  key={person.id}
                  type="button"
                  className={`diner${on ? ' diner--on' : ''}`}
                  aria-pressed={on}
                  aria-label={person.name}
                  aria-describedby={`diner-total-${person.id}`}
                  onClick={() => setSelected(on ? null : person.id)}
                >
                  <PersonPill person={person} size="lg" selected={on} decorative />
                  <span className="diner__name" aria-hidden="true">
                    {person.name}
                  </span>
                  <span className="diner__total num" id={`diner-total-${person.id}`}>
                    {formatAmount(totalOf(person.id))}
                  </span>
                </button>
              );
            })}
          </div>
          <SplitBar
            parts={people.map((person) => ({ person, cents: totalOf(person.id) }))}
          />
        </div>
      ) : null}

      {receipt.lines.length === 0 ? (
        <div className="stack">
          <p className="muted">Aucun plat sur ce ticket.</p>
          <button type="button" className="linkButton" onClick={onEditLines}>
            Saisir les lignes du ticket
          </button>
        </div>
      ) : null}

      <ul className="dishes">
        {receipt.lines.map((line) => {
          const assigned = line.assignments
            .map((assignment) => personById(people, assignment.personId))
            .filter((person): person is Person => Boolean(person));
          const caption = lineCaption(line);
          const discounts = discountsOn(line.id);
          return (
            <li key={line.id} className="dish">
              <DishButton
                onApply={() => toggleOnLine(line)}
                onEditShares={() => setSharesFor(line.id)}
              >
                <span className="dish__main">
                  <span className="dish__name">{lineTitle(line)}</span>
                  {caption ? <span className="dish__caption">{caption}</span> : null}
                  {discounts.map((adjustment) => {
                    const count = adjustment.lineIds?.length ?? 1;
                    return (
                      <span key={adjustment.id} className="dish__discount num">
                        {adjustment.label.toLowerCase()} {formatAmount(adjustment.amountCents)}
                        {count > 1 ? ` · sur ${count} plats` : ''}
                      </span>
                    );
                  })}
                </span>
                {assigned.length > 0 ? (
                  <PillStack people={assigned} />
                ) : people.length > 0 ? (
                  <span className="dish__everyone">Tous</span>
                ) : null}
                <span className="dish__price num">{formatAmount(line.totalCents)}</span>
              </DishButton>
            </li>
          );
        })}
      </ul>

      {people.length > 0 ? (
        <div className="dishTools">
          <p className="muted">
            {selectedPerson
              ? `Touchez un plat pour l’ajouter à ${selectedPerson.name} ou le lui retirer.`
              : 'Choisissez un convive, puis touchez ses plats.'}{' '}
            Un plat non attribué est partagé entre tous. Appui long : régler les parts.
          </p>
          <div className="dishTools__links">
            <button
              type="button"
              className="linkButton"
              disabled={!selectedPerson}
              onClick={() => selected && assignAll([{ personId: selected, shares: 1 }])}
            >
              {selectedPerson ? `Tout attribuer à ${selectedPerson.name}` : 'Tout attribuer à la sélection'}
            </button>
            <button
              type="button"
              className="linkButton"
              onClick={() => assignAll(people.map((person) => ({ personId: person.id, shares: 1 })))}
            >
              Tout partager entre tous
            </button>
          </div>
        </div>
      ) : null}

      <SharesSheet
        line={sharesLine}
        onClose={() => setSharesFor(null)}
        onChange={(assignments) => {
          if (sharesLine) setAssignments(sharesLine.id, assignments);
        }}
        onAddDiscount={
          people.length > 0 && sharesLine
            ? () => {
                setDiscountFor(sharesLine.id);
                setSharesFor(null);
              }
            : undefined
        }
      />

      <DishDiscountSheet
        line={receipt.lines.find((line) => line.id === discountFor) ?? null}
        onClose={() => setDiscountFor(null)}
        onAdd={(line, amountCents, label, split) => {
          addDishDiscount(line, amountCents, label, split);
          setDiscountFor(null);
        }}
      />

      <PhotoSheet open={photoOpen} src={imageUrl} onClose={() => setPhotoOpen(false)} />

      <Sheet
        open={confirmUnassigned}
        title="Lignes non attribuées"
        onClose={() => setConfirmUnassigned(false)}
        footer={
          <div className="row row--gap">
            <Button full onClick={() => setConfirmUnassigned(false)}>
              Revenir
            </Button>
            <Button variant="primary" full onClick={onDone}>
              Continuer quand même
            </Button>
          </div>
        }
      >
        <p className="muted">
          {unassigned.length} ligne{unassigned.length > 1 ? 's' : ''} ne
          {unassigned.length > 1 ? ' sont' : ' est'} attribuée
          {unassigned.length > 1 ? 's' : ''} à personne, et aucun participant n’est là pour
          les reprendre. Leur montant ne sera compté dans aucun solde, et le total réparti
          sera inférieur au total du ticket.
        </p>
      </Sheet>
    </Screen>
  );
}

type DishButtonProps = {
  onApply: () => void;
  onEditShares: () => void;
  children: ReactNode;
};

function DishButton({ onApply, onEditShares, children }: DishButtonProps) {
  const press = useLongPress({ onLongPress: onEditShares, onClick: onApply });
  return (
    <button type="button" className="dish__hit" {...press}>
      {children}
    </button>
  );
}

type SharesSheetProps = {
  line: ReceiptLine | null;
  onClose: () => void;
  onChange: (assignments: Assignment[]) => void;
  /** Absent when nobody can receive a discount. */
  onAddDiscount?: (() => void) | undefined;
};

function SharesSheet({ line, onClose, onChange, onAddDiscount }: SharesSheetProps) {
  const people = useGroupPeople();
  if (!line) return null;

  const assignments = line.assignments;
  const weights = assignments.map((assignment) => assignment.shares);
  const preview = splitCents(line.totalCents, weights);
  const totalShares = weights.reduce((sum, value) => sum + value, 0);

  return (
    <Sheet
      open
      title={lineTitle(line)}
      onClose={onClose}
      footer={
        <Button variant="primary" full onClick={onClose}>
          Terminé
        </Button>
      }
    >
      <p className="muted">
        {line.description && line.description.trim() !== line.label.trim() ? (
          <span className="shares__code">{line.label} · </span>
        ) : null}
        Montant du plat : <span className="num">{formatAmount(line.totalCents)}</span>
      </p>
      <ul className="shares">
        {people.map((person) => {
          const index = assignments.findIndex((a) => a.personId === person.id);
          const assignment = index >= 0 ? assignments[index] : null;
          return (
            <li key={person.id} className="shares__row">
              <input
                type="checkbox"
                checked={assignment !== null}
                aria-label={`Inclure ${person.name}`}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...assignments, { personId: person.id, shares: 1 }]
                      : assignments.filter((a) => a.personId !== person.id),
                  )
                }
              />
              <PersonPill person={person} size="sm" decorative />
              <span className="shares__name">{person.name}</span>
              <input
                type="number"
                min={0}
                step={1}
                className="shares__value num"
                value={assignment?.shares ?? 0}
                disabled={assignment === null}
                aria-label={`Parts de ${person.name}`}
                onChange={(event) => {
                  const shares = Math.max(0, Number(event.target.value) || 0);
                  onChange(
                    assignments.map((a) => (a.personId === person.id ? { ...a, shares } : a)),
                  );
                }}
              />
              <span className="shares__amount num">
                {index >= 0 ? formatAmount(preview[index] as number) : '—'}
              </span>
              <span className="shares__percent muted num">
                {index >= 0 && totalShares > 0
                  ? `${Math.round(((assignment?.shares ?? 0) / totalShares) * 100)} %`
                  : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {onAddDiscount ? (
        <button type="button" className="linkButton" onClick={onAddDiscount}>
          Ajouter une remise sur ce produit
        </button>
      ) : null}
    </Sheet>
  );
}

type DishDiscountSheetProps = {
  line: ReceiptLine | null;
  onClose: () => void;
  onAdd: (line: ReceiptLine, amountCents: number, label: string, split: DishSplit) => void;
};

function DishDiscountSheet({ line, onClose, onAdd }: DishDiscountSheetProps) {
  if (!line) return null;
  return <DishDiscountForm key={line.id} line={line} onClose={onClose} onAdd={onAdd} />;
}

function DishDiscountForm({
  line,
  onClose,
  onAdd,
}: DishDiscountSheetProps & { line: ReceiptLine }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(0);
  const [split, setSplit] = useState<DishSplit>('prorata');
  return (
    <Sheet
      open
      title={`Remise sur ${lineTitle(line)}`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          full
          disabled={amount === 0}
          onClick={() => onAdd(line, amount, label.trim() || 'Remise', split)}
        >
          Ajouter
        </Button>
      }
    >
      <label className="field">
        <span className="field__label">Libellé</span>
        <input
          type="text"
          value={label}
          placeholder="Remise"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Montant</span>
        <AmountInput
          valueCents={amount}
          onChange={(cents) => setAmount(Math.abs(cents ?? 0))}
          aria-label="Montant de la remise"
        />
      </label>
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
          ? 'Partagée à parts égales entre les personnes de ce plat.'
          : 'Répartie entre les personnes de ce plat, au prorata de leur part.'}{' '}
        Elle suit le plat si vous changez qui l’a pris.
      </p>
    </Sheet>
  );
}
