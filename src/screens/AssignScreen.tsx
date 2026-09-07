import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { Sheet } from '../ui/Sheet';
import { AmountInput } from '../ui/AmountInput';
import { PersonPill } from '../ui/PersonPill';
import { useAppStore } from '../store/useAppStore';
import { useGroupPeople } from '../hooks/useGroupPeople';
import { formatCents } from '../lib/money';
import { splitCents } from '../lib/split';
import { uid } from '../lib/id';
import { personById } from '../lib/people';
import { useLongPress } from '../hooks/useLongPress';
import type { Adjustment, Assignment, Receipt, ReceiptLine } from '../types';

type AssignScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onDone: () => void;
};

function sameAssignment(line: ReceiptLine, ids: readonly string[]): boolean {
  if (line.assignments.length !== ids.length) return false;
  const assigned = new Set(line.assignments.map((a) => a.personId));
  return ids.every((id) => assigned.has(id)) && line.assignments.every((a) => a.shares === 1);
}

export function AssignScreen({ receipt, onBack, onDone }: AssignScreenProps) {
  /* The participants are the tricount's members: there is nobody left to add
     here. Someone missing gets added in Tricount, then picked up via "Refresh"
     on the group screen — that is where the list is authoritative. */
  const people = useGroupPeople();
  const updateReceipt = useAppStore((s) => s.updateReceipt);

  const [selected, setSelected] = useState<string[]>([]);
  const [sharesFor, setSharesFor] = useState<string | null>(null);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [confirmUnassigned, setConfirmUnassigned] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

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
    setSelected([people[0]!.id]);
  }, [people]);

  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const applyToLine = (line: ReceiptLine) => {
    if (selected.length === 0) return;
    const assignments: Assignment[] = sameAssignment(line, selected)
      ? []
      : selected.map((personId) => ({ personId, shares: 1 }));
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.map((item) => (item.id === line.id ? { ...item, assignments } : item)),
    }));
  };

  const setAssignments = (lineId: string, assignments: Assignment[]) => {
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.map((item) => (item.id === lineId ? { ...item, assignments } : item)),
    }));
  };

  const assignAll = (assignments: Assignment[]) => {
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.map((line) => ({ ...line, assignments: [...assignments] })),
    }));
  };

  const scrollToFirstUnassigned = () => {
    const first = unassigned[0];
    if (!first) return;
    rowRefs.current.get(first.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const sharesLine = receipt.lines.find((line) => line.id === sharesFor) ?? null;

  return (
    <Screen
      title="Attribution"
      onBack={onBack}
      banner={
        unassigned.length > 0 ? (
          <Banner
            label="Lignes non attribuées"
            tone={people.length === 0 ? 'warn' : 'neutral'}
            action={
              <button type="button" className="linkButton" onClick={scrollToFirstUnassigned}>
                Voir
              </button>
            }
          >
            {unassigned.length} ligne{unassigned.length > 1 ? 's' : ''} non attribuée
            {unassigned.length > 1 ? 's' : ''}
            {people.length === 0
              ? ' — ce tricount n’a aucun participant, elles resteront hors répartition'
              : ` — partagée${unassigned.length > 1 ? 's' : ''} entre les ${people.length} participants`}
          </Banner>
        ) : null
      }
      footer={
        <Button
          variant="primary"
          full
          onClick={() =>
            unassigned.length > 0 && people.length === 0 ? setConfirmUnassigned(true) : onDone()
          }
        >
          Voir les résultats
        </Button>
      }
    >
      <div className="brush">
        <div className="brush__pills">
          {people.map((person) => (
            <PersonPill
              key={person.id}
              person={person}
              selected={selected.includes(person.id)}
              onClick={() => toggleSelected(person.id)}
            />
          ))}
        </div>
        <p className="brush__hint">
          {people.length === 0
            ? 'Aucun participant dans ce tricount. Ajoutez-en dans Tricount, puis rafraîchissez depuis l’écran du groupe.'
            : selected.length === 0
              ? 'Sélectionnez au moins une personne, puis touchez les lignes.'
              : selected.length === 1
                ? 'Touchez les lignes à attribuer. Appui long : régler les parts.'
                : `Touchez les lignes à partager entre ${selected.length} personnes.`}
          {people.length > 0
            ? ' Une ligne laissée sans attribution est partagée entre tout le monde.'
            : ''}
        </p>
        <div className="brush__actions">
          <button
            type="button"
            className="linkButton"
            disabled={selected.length === 0}
            onClick={() => assignAll(selected.map((personId) => ({ personId, shares: 1 })))}
          >
            Tout attribuer à la sélection
          </button>
          <button
            type="button"
            className="linkButton"
            disabled={people.length === 0}
            onClick={() => assignAll(people.map((person) => ({ personId: person.id, shares: 1 })))}
          >
            Tout partager entre tous
          </button>
          <button
            type="button"
            className="linkButton"
            onClick={() =>
              setSelected(people.filter((p) => !selected.includes(p.id)).map((p) => p.id))
            }
          >
            Inverser la sélection
          </button>
        </div>
      </div>

      <ul className="lines">
        {receipt.lines.map((line) => {
          const assigned = line.assignments
            .map((assignment) => personById(people, assignment.personId))
            .filter((person): person is NonNullable<typeof person> => Boolean(person));
          return (
            <li
              key={line.id}
              className={`assignRow${line.assignments.length === 0 ? ' assignRow--none' : ''}`}
              ref={(node) => {
                if (node) rowRefs.current.set(line.id, node);
                else rowRefs.current.delete(line.id);
              }}
            >
              <AssignRowButton
                line={line}
                onApply={() => applyToLine(line)}
                onEditShares={() => setSharesFor(line.id)}
              >
                <div className="assignRow__main">
                  <span className="assignRow__title">
                    {line.description?.trim() || line.label || 'Sans libellé'}
                    {line.quantity > 1 ? <span className="muted"> ×{line.quantity}</span> : null}
                  </span>
                  {line.description && line.description.trim() !== line.label.trim() ? (
                    <span className="assignRow__code">{line.label}</span>
                  ) : null}
                </div>
                <span className="assignRow__pills">
                  {(line.assignments.length === 0 ? people : assigned).map((person) => (
                    <PersonPill
                      key={person.id}
                      person={person}
                      size="sm"
                      ghost={line.assignments.length === 0}
                    />
                  ))}
                </span>
                <span className="assignRow__amount num">{formatCents(line.totalCents)}</span>
              </AssignRowButton>
            </li>
          );
        })}
      </ul>

      <div className="stack">
        <div className="row row--between">
          <h2>Ajustements</h2>
          <button type="button" className="linkButton" onClick={() => setAdjustmentOpen(true)}>
            + Ajouter
          </button>
        </div>
        {receipt.adjustments.length === 0 ? (
          <p className="muted">Remise, sac, arrondi de caisse… rien pour l’instant.</p>
        ) : (
          <ul className="lines">
            {receipt.adjustments.map((adjustment) => (
              <li key={adjustment.id} className="lineRow lineRow--compact">
                <span>
                  {adjustment.label}
                  <span className="muted">
                    {' · '}
                    {adjustment.mode === 'proportional' ? 'au prorata' : 'attribué'}
                  </span>
                </span>
                <span className="num">{formatCents(adjustment.amountCents)}</span>
                <button
                  type="button"
                  className="iconButton iconButton--quiet"
                  aria-label={`Supprimer ${adjustment.label}`}
                  onClick={() =>
                    updateReceipt((current) => ({
                      ...current,
                      adjustments: current.adjustments.filter((a) => a.id !== adjustment.id),
                    }))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SharesSheet
        line={sharesLine}
        onClose={() => setSharesFor(null)}
        onChange={(assignments) => {
          if (sharesLine) setAssignments(sharesLine.id, assignments);
        }}
      />

      <AdjustmentSheet
        open={adjustmentOpen}
        onClose={() => setAdjustmentOpen(false)}
        onCreate={(adjustment) => {
          updateReceipt((current) => ({
            ...current,
            adjustments: [...current.adjustments, adjustment],
          }));
          setAdjustmentOpen(false);
        }}
      />

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

type AssignRowButtonProps = {
  line: ReceiptLine;
  onApply: () => void;
  onEditShares: () => void;
  children: ReactNode;
};

function AssignRowButton({ onApply, onEditShares, children }: AssignRowButtonProps) {
  const press = useLongPress({ onLongPress: onEditShares, onClick: onApply });
  return (
    <button type="button" className="assignRow__hit" {...press}>
      {children}
    </button>
  );
}

type SharesSheetProps = {
  line: ReceiptLine | null;
  onClose: () => void;
  onChange: (assignments: Assignment[]) => void;
};

function SharesSheet({ line, onClose, onChange }: SharesSheetProps) {
  const people = useGroupPeople();
  if (!line) return null;

  const assignments = line.assignments;
  const weights = assignments.map((assignment) => assignment.shares);
  const preview = splitCents(line.totalCents, weights);
  const totalShares = weights.reduce((sum, value) => sum + value, 0);

  return (
    <Sheet
      open
      title={line.description?.trim() || line.label || 'Ligne'}
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
        Montant de la ligne : <span className="num">{formatCents(line.totalCents)}</span>
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
                {index >= 0 ? formatCents(preview[index] as number) : '—'}
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
    </Sheet>
  );
}

type AdjustmentSheetProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (adjustment: Adjustment) => void;
};

function AdjustmentSheet({ open, onClose, onCreate }: AdjustmentSheetProps) {
  const people = useGroupPeople();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(0);
  const [negative, setNegative] = useState(true);
  const [mode, setMode] = useState<Adjustment['mode']>('proportional');
  const [targets, setTargets] = useState<string[]>([]);

  if (!open) return null;

  const create = () => {
    const signed = negative ? -Math.abs(amount) : Math.abs(amount);
    onCreate({
      id: uid(),
      label: label.trim() || (negative ? 'Remise' : 'Supplément'),
      amountCents: signed,
      mode,
      assignments: mode === 'assigned' ? targets.map((id) => ({ personId: id, shares: 1 })) : [],
    });
    setLabel('');
    setAmount(0);
    setTargets([]);
  };

  return (
    <Sheet
      open
      title="Ajustement"
      onClose={onClose}
      footer={
        <Button variant="primary" full disabled={amount === 0} onClick={create}>
          Ajouter
        </Button>
      }
    >
      <label className="field">
        <span className="field__label">Libellé</span>
        <input
          type="text"
          value={label}
          placeholder="Remise fidélité, sac, arrondi caisse…"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <div className="row row--gap">
        <label className="field field--grow">
          <span className="field__label">Montant</span>
          <AmountInput
            valueCents={amount}
            onChange={(cents) => setAmount(cents ?? 0)}
            aria-label="Montant"
          />
        </label>
        <label className="field field--grow">
          <span className="field__label">Sens</span>
          <select
            value={negative ? 'remise' : 'supplement'}
            onChange={(event) => setNegative(event.target.value === 'remise')}
          >
            <option value="remise">Remise (−)</option>
            <option value="supplement">Supplément (+)</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field__label">Répartition</span>
        <select value={mode} onChange={(event) => setMode(event.target.value as Adjustment['mode'])}>
          <option value="proportional">Au prorata de ce que chacun doit</option>
          <option value="assigned">Attribué à…</option>
        </select>
      </label>
      {mode === 'assigned' ? (
        <ul className="shares">
          {people.map((person) => (
            <li key={person.id} className="shares__row">
              <input
                type="checkbox"
                checked={targets.includes(person.id)}
                aria-label={`Attribuer à ${person.name}`}
                onChange={(event) =>
                  setTargets((current) =>
                    event.target.checked
                      ? [...current, person.id]
                      : current.filter((id) => id !== person.id),
                  )
                }
              />
              <span className="shares__name">{person.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}
