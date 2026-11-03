import { useEffect, useMemo, useRef, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { AmountInput } from '../ui/AmountInput';
import { PhotoSheet } from '../ui/PhotoSheet';
import { useReceiptImage } from '../hooks/useReceiptImage';
import { useAppStore } from '../store/useAppStore';
import { formatCents, roundHalfUp } from '../lib/money';
import { adjustmentsTotal, subtotalOf, taxesTotalOf } from '../lib/compute';
import { uid } from '../lib/id';
import type { Receipt, ReceiptLine } from '../types';

type VerifyScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onDone: () => void;
};

const LOW_CONFIDENCE = 70;

type QuantityInputProps = {
  value: number;
  onChange: (quantity: number) => void;
};

/* Clearing the field to retype a quantity must not take the line through
   "1 unit": that detour would rebase the unit price and carry off a few cents.
   So the field keeps its in-progress input and only publishes valid quantities. */
function QuantityInput({ value, onChange }: QuantityInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  return (
    <input
      type="number"
      min={1}
      max={999}
      className="lineRow__qty num"
      value={draft}
      aria-label="Quantité"
      onFocus={(event) => {
        focused.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const parsed = Number(text);
        if (text.trim() === '' || !Number.isFinite(parsed) || parsed < 1) return;
        onChange(Math.floor(parsed));
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(String(value));
      }}
    />
  );
}

function emptyLine(): ReceiptLine {
  return {
    id: uid(),
    label: '',
    description: null,
    quantity: 1,
    unitPriceCents: 0,
    totalCents: 0,
    taxCodes: null,
    assignments: [],
    confidence: 100,
    isManual: true,
  };
}

export function VerifyScreen({ receipt, onBack, onDone }: VerifyScreenProps) {
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const [photoOpen, setPhotoOpen] = useState(false);
  const imageUrl = useReceiptImage(receipt.id, receipt.imageId);

  const subtotal = useMemo(() => subtotalOf(receipt), [receipt]);
  const taxes = taxesTotalOf(receipt.taxes);
  const adjustments = adjustmentsTotal(receipt.adjustments);
  const computed = subtotal + taxes + adjustments;
  const stated = receipt.statedTotalCents;
  const gap = stated === null ? 0 : computed - stated;
  const subtotalGap =
    receipt.statedSubtotalCents === null ? 0 : subtotal - receipt.statedSubtotalCents;

  const patchLine = (id: string, patch: Partial<ReceiptLine>) => {
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    }));
  };

  const setQuantity = (line: ReceiptLine, quantity: number) => {
    const safe = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
    if (safe === line.quantity) return;
    /* The displayed unit price is a rounding: 3 beers at $10.00 show as
       3 × 3.33. Starting from it would drop the line to $9.99. So we rescale the
       real total, the only amount that appears on the receipt. */
    const totalCents = roundHalfUp((line.totalCents / Math.max(1, line.quantity)) * safe);
    patchLine(line.id, {
      quantity: safe,
      totalCents,
      unitPriceCents: roundHalfUp(totalCents / safe),
      isManual: true,
    });
  };

  const setUnitPrice = (line: ReceiptLine, unitPriceCents: number) => {
    patchLine(line.id, {
      unitPriceCents,
      totalCents: unitPriceCents * line.quantity,
      isManual: true,
    });
  };

  const setTotal = (line: ReceiptLine, totalCents: number) => {
    patchLine(line.id, {
      totalCents,
      // The entered total is authoritative; the unit price is only its rounded display.
      unitPriceCents: roundHalfUp(totalCents / Math.max(1, line.quantity)),
      isManual: true,
    });
  };

  const addLine = () => {
    updateReceipt((current) => ({ ...current, lines: [...current.lines, emptyLine()] }));
  };

  const removeLine = (id: string) => {
    updateReceipt((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.id !== id),
    }));
  };

  return (
    <Screen
      title="Vérification"
      onBack={onBack}
      action={
        receipt.imageId ? (
          <button type="button" className="linkButton" onClick={() => setPhotoOpen(true)}>
            Voir la photo
          </button>
        ) : null
      }
      banner={
        <Banner
          label="Contrôle du total"
          tone={stated !== null && gap !== 0 ? 'warn' : 'neutral'}
        >
          {stated === null ? (
            <>
              Sous-total <span className="num">{formatCents(subtotal)}</span> + taxes{' '}
              <span className="num">{formatCents(taxes)}</span> ={' '}
              <span className="num">{formatCents(computed)}</span>
              {' · '}
              <span className="muted">total du ticket non renseigné</span>
            </>
          ) : gap === 0 ? (
            <>
              Sous-total <span className="num">{formatCents(subtotal)}</span> + taxes{' '}
              <span className="num">{formatCents(taxes)}</span> = Total du ticket{' '}
              <span className="num">{formatCents(stated)}</span> ✓
            </>
          ) : receipt.statedSubtotalCents === null ? (
            <>
              Écart de <span className="num">{formatCents(Math.abs(gap))}</span> — vérifiez les
              lignes{taxes !== 0 ? ' et les taxes' : ''}
            </>
          ) : subtotalGap !== 0 ? (
            <>
              Écart de <span className="num">{formatCents(Math.abs(subtotalGap))}</span> sur le
              sous-total — vérifiez les lignes
            </>
          ) : (
            <>
              Écart de <span className="num">{formatCents(Math.abs(gap))}</span> — les lignes
              tombent juste, vérifiez les taxes
            </>
          )}
        </Banner>
      }
      footer={
        <Button variant="primary" full onClick={onDone} disabled={receipt.lines.length === 0}>
          Continuer
        </Button>
      }
    >
      <div className="fields">
        <label className="field">
          <span className="field__label">Commerçant</span>
          <input
            type="text"
            value={receipt.merchant ?? ''}
            placeholder="Carrefour, boulangerie…"
            onChange={(event) =>
              updateReceipt({ merchant: event.target.value || null })
            }
          />
        </label>
        <div className="row row--gap">
          <label className="field field--grow">
            <span className="field__label">Date</span>
            <input
              type="date"
              value={receipt.purchaseDate ?? ''}
              onChange={(event) =>
                updateReceipt({ purchaseDate: event.target.value || null })
              }
            />
          </label>
          <label className="field field--grow">
            <span className="field__label">Sous-total lu</span>
            <AmountInput
              valueCents={receipt.statedSubtotalCents}
              onChange={(cents) => updateReceipt({ statedSubtotalCents: cents })}
              placeholder="—"
              aria-label="Sous-total lu sur le ticket"
            />
          </label>
          <label className="field field--grow">
            <span className="field__label">Total lu</span>
            <AmountInput
              valueCents={receipt.statedTotalCents}
              onChange={(cents) => updateReceipt({ statedTotalCents: cents })}
              placeholder="—"
              aria-label="Total lu sur le ticket"
            />
          </label>
        </div>
      </div>

      {receipt.lines.length === 0 ? (
        <p className="muted">
          {receipt.imageId
            ? 'La lecture n’a trouvé aucune ligne. Saisissez-les ici, ou reprenez une photo plus nette.'
            : 'Aucune ligne pour l’instant. Ajoutez celles du ticket.'}
        </p>
      ) : null}

      <ul className="lines">
        {receipt.lines.map((line) => (
          <li key={line.id} className="lineRow">
            <div className="lineRow__top">
              {line.confidence < LOW_CONFIDENCE && !line.isManual ? (
                <span
                  className="dot"
                  title={`Lecture peu sûre (${line.confidence} %)`}
                  aria-label="Lecture peu sûre"
                />
              ) : (
                <span className="dot dot--empty" aria-hidden="true" />
              )}
              <div className="lineRow__labels">
                <input
                  type="text"
                  className="lineRow__label"
                  value={line.label}
                  placeholder="Libellé imprimé"
                  aria-label="Libellé de la ligne"
                  onChange={(event) => patchLine(line.id, { label: event.target.value })}
                />
                <input
                  type="text"
                  className="lineRow__sublabel"
                  value={line.description ?? ''}
                  placeholder="Explication / produit décodé…"
                  aria-label={`Explication de ${line.label || 'la ligne'}`}
                  onChange={(event) =>
                    patchLine(line.id, { description: event.target.value || null })
                  }
                />
              </div>
              <button
                type="button"
                className="iconButton iconButton--quiet"
                aria-label={`Supprimer ${line.label || 'la ligne'}`}
                onClick={() => removeLine(line.id)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="lineRow__bottom">
              <QuantityInput
                value={line.quantity}
                onChange={(quantity) => setQuantity(line, quantity)}
              />
              <span className="lineRow__times" aria-hidden="true">×</span>
              <AmountInput
                valueCents={line.unitPriceCents}
                onChange={(cents) => setUnitPrice(line, cents ?? 0)}
                aria-label="Prix unitaire"
                className="lineRow__unit"
              />
              <label className="lineRow__taxable">
                <input
                  type="checkbox"
                  checked={line.taxCodes === null || line.taxCodes.length > 0}
                  aria-label={`${line.label || 'Ligne'} : soumise aux taxes`}
                  onChange={(event) =>
                    patchLine(line.id, { taxCodes: event.target.checked ? null : [] })
                  }
                />
                <span>Tx</span>
              </label>
              <AmountInput
                valueCents={line.totalCents}
                onChange={(cents) => setTotal(line, cents ?? 0)}
                aria-label="Total de la ligne"
                className="lineRow__total"
              />
            </div>
          </li>
        ))}
      </ul>

      <button type="button" className="linkButton linkButton--center" onClick={addLine}>
        + Ajouter une ligne
      </button>

      <p className="muted">
        Les taxes, les remises et l’écart avec le total se règlent à l’étape Ajustements.
      </p>

      <PhotoSheet open={photoOpen} src={imageUrl} onClose={() => setPhotoOpen(false)} />
    </Screen>
  );
}
