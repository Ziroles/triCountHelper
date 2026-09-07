import { useEffect, useRef, useState } from 'react';
import { centsToInput, parseAmountToCents } from '../lib/money';

type AmountInputProps = {
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  'aria-label'?: string;
  className?: string;
  allowNegative?: boolean;
  placeholder?: string;
};

export function AmountInput({
  valueCents,
  onChange,
  className = '',
  allowNegative = false,
  placeholder = '0,00',
  ...rest
}: AmountInputProps) {
  const [draft, setDraft] = useState(() => (valueCents === null ? '' : centsToInput(valueCents)));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(valueCents === null ? '' : centsToInput(valueCents));
  }, [valueCents]);

  const commit = (text: string) => {
    const cents = parseAmountToCents(text);
    if (cents === null) {
      if (text.trim() === '') {
        if (valueCents !== null) onChange(null);
        setDraft('');
        return;
      }
      setDraft(valueCents === null ? '' : centsToInput(valueCents));
      return;
    }
    const next = allowNegative ? cents : Math.abs(cents);
    setDraft(centsToInput(next));
    /* A round trip through the field must not rewrite anything: republishing an
       unchanged value would restart the derived computations, which lose a cent
       along the way. */
    if (next !== valueCents) onChange(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`amountInput num ${className}`.trim()}
      value={draft}
      placeholder={placeholder}
      onFocus={(event) => {
        focused.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const cents = parseAmountToCents(text);
        if (cents === null) return;
        const next = allowNegative ? cents : Math.abs(cents);
        if (next !== valueCents) onChange(next);
      }}
      onBlur={(event) => {
        focused.current = false;
        commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      {...rest}
    />
  );
}
