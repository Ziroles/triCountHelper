import type { Person } from '../types';

/* Attribuées dans l'ordre du groupe Tricount : la même personne garde la même
   couleur d'un écran à l'autre. */
export const PERSON_COLORS = [
  'var(--st-p1)',
  'var(--st-p2)',
  'var(--st-p3)',
  'var(--st-p4)',
  'var(--st-p5)',
  'var(--st-p6)',
  'var(--st-p7)',
  'var(--st-p8)',
] as const;

export function colorForIndex(index: number): string {
  return PERSON_COLORS[index % PERSON_COLORS.length] as string;
}

export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    return (words[0] as string).slice(0, 2).toUpperCase();
  }
  return `${(words[0] as string)[0]}${(words[1] as string)[0]}`.toUpperCase();
}

export function personById(people: readonly Person[], id: string): Person | undefined {
  return people.find((p) => p.id === id);
}
