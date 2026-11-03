import { useEffect, useRef, useState } from 'react';

type PercentInputProps = {
  value: number | null;
  onChange: (percent: number | null) => void;
  'aria-label'?: string;
  className?: string;
  placeholder?: string;
};

/** `22`, `12,5`, `12.5` → a rate with one decimal at most, between 0 and 100. */
export function parsePercent(input: string): number | null {
  const text = input.trim().replace(/\s|%/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d)?$/.test(text)) return null;
  const value = Number(text);
  return value <= 100 ? value : null;
}

export function formatPercent(value: number): string {
  return String(value).replace('.', ',');
}

/**
 * A rate typed by hand. Same draft logic as `AmountInput`: comma or dot, and
 * nothing is rewritten while the field has the focus.
 */
export function PercentInput({
  value,
  onChange,
  className = '',
  placeholder = '0',
  ...rest
}: PercentInputProps) {
  const [draft, setDraft] = useState(() => (value === null ? '' : formatPercent(value)));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value === null ? '' : formatPercent(value));
  }, [value]);

  const publish = (text: string) => {
    const parsed = parsePercent(text);
    if (parsed === null) return false;
    if (parsed !== value) onChange(parsed);
    return true;
  };

  return (
    <span className={`percentInput ${className}`.trim()}>
      <input
        type="text"
        inputMode="decimal"
        className="amountInput num"
        value={draft}
        placeholder={placeholder}
        onFocus={(event) => {
          focused.current = true;
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          publish(event.target.value);
        }}
        onBlur={(event) => {
          focused.current = false;
          const text = event.target.value;
          if (text.trim() === '') {
            if (value !== null) onChange(null);
            setDraft('');
            return;
          }
          if (!publish(text)) {
            setDraft(value === null ? '' : formatPercent(value));
            return;
          }
          setDraft(formatPercent(parsePercent(text) ?? 0));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        {...rest}
      />
      <span className="percentInput__unit" aria-hidden="true">
        %
      </span>
    </span>
  );
}
