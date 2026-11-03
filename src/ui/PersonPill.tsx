import type { CSSProperties } from 'react';
import { initialsOf } from '../lib/people';
import type { Person } from '../types';

type PersonPillProps = {
  person: Person;
  /** sm : pastille 22px sur une ligne de plat ; md : 36px (Envoi) ; lg : 44px (convives). */
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  title?: string;
  /** The name is already written next to the avatar: hide it from screen readers. */
  decorative?: boolean;
};

/** Avatar rond à la couleur du convive, toujours accompagné de ses initiales. */
export function PersonPill({
  person,
  size = 'md',
  selected = false,
  title,
  decorative = false,
}: PersonPillProps) {
  const style = { '--pill-color': person.color ?? 'var(--st-p1)' } as CSSProperties;
  return (
    <span
      className={`pill pill--${size}${selected ? ' pill--on' : ''}`}
      style={style}
      title={decorative ? undefined : (title ?? person.name)}
      aria-hidden={decorative || undefined}
    >
      <span className="pill__initials" aria-hidden="true">
        {initialsOf(person.name)}
      </span>
      <span className="visually-hidden">{person.name}</span>
    </span>
  );
}

/** Pastilles chevauchées des personnes d'un plat. */
export function PillStack({ people }: { people: Person[] }) {
  return (
    <span className="pillStack">
      {people.map((person) => (
        <PersonPill key={person.id} person={person} size="sm" />
      ))}
    </span>
  );
}
