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
import { regimeByCode, type Receipt, type ReceiptLine, type ReceiptTax } from '../types';

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

/* Vider le champ pour retaper une quantité ne doit pas faire passer la ligne par
   « 1 unité » : ce détour rebaserait le prix unitaire et emporterait des centimes.
   Le champ garde donc sa saisie en cours et ne publie que les quantités valides. */
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

  const settings = useAppStore((s) => s.settings);
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
    /* Le prix unitaire affiché est un arrondi : 3 bières à 10,00 $ s'affichent
       3 × 3,33. Repartir de lui ferait tomber la ligne à 9,99 $. On remet donc à
       l'échelle le total réel, seul montant qui figure sur le ticket. */
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
      // Le total saisi fait foi ; le prix unitaire n'en est que l'affichage arrondi.
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

  const patchTax = (id: string, patch: Partial<ReceiptTax>) => {
    updateReceipt((current) => ({
      ...current,
      taxes: current.taxes.map((tax) => (tax.id === id ? { ...tax, ...patch } : tax)),
    }));
  };

  const removeTax = (id: string) => {
    updateReceipt((current) => ({
      ...current,
      taxes: current.taxes.filter((tax) => tax.id !== id),
    }));
  };

  const addRegimeTaxes = () => {
    const regime = regimeByCode(settings.taxRegimeCode);
    updateReceipt((current) => ({
      ...current,
      taxes: regime.taxes.map((tax) => ({
        id: uid(),
        code: tax.code,
        label: tax.label,
        ratePercent: tax.ratePercent,
        amountCents: 0,
      })),
    }));
  };

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
          action={
            stated !== null && gap !== 0 ? (
              <button type="button" className="linkButton" onClick={absorbGap}>
                Ajouter en ajustement
              </button>
            ) : null
          }
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
          Attribuer
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
                ✕
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

      <div className="stack">
        <div className="row row--between">
          <h2>Taxes</h2>
          {receipt.taxes.length === 0 ? (
            <button type="button" className="linkButton" onClick={addRegimeTaxes}>
              + {regimeByCode(settings.taxRegimeCode).label}
            </button>
          ) : (
            <span className="num muted">{formatCents(taxes)}</span>
          )}
        </div>
        {receipt.taxes.length === 0 ? (
          <p className="muted">
            Aucune taxe lue sur ce ticket. Ajoutez-les si elles y figurent : les prix des
            lignes sont hors taxes.
          </p>
        ) : (
          <ul className="lines">
            {receipt.taxes.map((tax) => (
              <li key={tax.id} className="lineRow lineRow--compact">
                <input
                  type="text"
                  className="grow"
                  value={tax.label}
                  aria-label="Nom de la taxe"
                  onChange={(event) => patchTax(tax.id, { label: event.target.value })}
                />
                <AmountInput
                  valueCents={tax.amountCents}
                  onChange={(cents) => patchTax(tax.id, { amountCents: cents ?? 0 })}
                  allowNegative
                  aria-label={`Montant de ${tax.label}`}
                  className="lineRow__total"
                />
                <button
                  type="button"
                  className="iconButton iconButton--quiet"
                  aria-label={`Supprimer ${tax.label}`}
                  onClick={() => removeTax(tax.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {receipt.adjustments.length > 0 ? (
        <div className="stack">
          <h2>Ajustements</h2>
          <ul className="lines">
            {receipt.adjustments.map((adjustment) => (
              <li key={adjustment.id} className="lineRow lineRow--compact">
                <span>{adjustment.label}</span>
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
        </div>
      ) : null}

      <PhotoSheet open={photoOpen} src={imageUrl} onClose={() => setPhotoOpen(false)} />
    </Screen>
  );
}
