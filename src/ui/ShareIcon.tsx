type ShareIconProps = {
  /** Number of people sharing the line. */
  count: number;
  /** True when the line follows the default split, for lack of an assignment. */
  auto?: boolean;
  /** The icon duplicates nearby text: no need to repeat it to screen readers. */
  decorative?: boolean;
};

/** Tells apart at a glance what a person takes on alone from what they share. */
export function ShareIcon({ count, auto = false, decorative = false }: ShareIconProps) {
  const shared = count > 1;
  const label = shared
    ? `Partagé à ${count}${auto ? ' — réparti par défaut' : ''}`
    : 'Payé seul';

  return (
    <span
      className={`shareIcon${shared ? ' shareIcon--shared' : ''}`}
      title={decorative ? undefined : label}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
        {shared ? (
          <>
            <circle cx="5.2" cy="5.1" r="2.5" />
            <path d="M5.2 8.4C2.7 8.4 1.2 9.9.9 12.1c-.1.6.4 1.2 1 1.2h6.6c.6 0 1.1-.6 1-1.2-.3-2.2-1.8-3.7-4.3-3.7z" />
            <circle cx="11.6" cy="5.7" r="2" opacity=".5" />
            <path
              d="M11.6 8.6c-.6 0-1.1.07-1.6.22.85.79 1.4 1.83 1.6 3.06h2.6c.55 0 1-.5.9-1.05-.28-1.55-1.5-2.23-3.5-2.23z"
              opacity=".5"
            />
          </>
        ) : (
          <>
            <circle cx="8" cy="5" r="2.7" />
            <path d="M8 8.5c-3 0-4.7 1.7-5 4-.1.6.4 1.2 1 1.2h8c.6 0 1.1-.6 1-1.2-.3-2.3-2-4-5-4z" />
          </>
        )}
      </svg>
      {decorative ? null : <span className="visually-hidden">{label}</span>}
    </span>
  );
}
