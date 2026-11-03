type SegmentedOption<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  label: string;
  options: readonly SegmentedOption<T>[];
  /** Null : aucun segment actif (ex. un pourboire qui ne tombe sur aucun pourcentage). */
  value: T | null;
  onChange: (value: T) => void;
};

/** Contrôle segmenté : de vrais boutons, l'actif est signalé par `aria-pressed`. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`seg__item${option.value === value ? ' seg__item--on' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
