import type { Person } from '../types';

type SplitBarProps = {
  parts: { person: Person; cents: number }[];
};

/**
 * Barre de répartition : un segment par convive, large de sa part du total.
 * La couleur n'y est jamais le seul repère : l'`aria-label` donne les parts,
 * et les initiales accompagnent la même couleur juste au-dessus.
 */
export function SplitBar({ parts }: SplitBarProps) {
  const visible = parts.filter((part) => part.cents > 0);
  const total = visible.reduce((sum, part) => sum + part.cents, 0);
  const percent = (cents: number) => (total === 0 ? 0 : (cents / total) * 100);
  const label =
    total === 0
      ? 'Répartition du total : rien d’attribué pour l’instant'
      : `Répartition du total : ${visible
          .map((part) => `${part.person.name} ${Math.round(percent(part.cents))} %`)
          .join(', ')}`;

  return (
    <div className="splitBar" role="img" aria-label={label}>
      {visible.map((part) => (
        <span
          key={part.person.id}
          className="splitBar__part"
          style={{ flexGrow: part.cents, background: part.person.color }}
        />
      ))}
    </div>
  );
}
