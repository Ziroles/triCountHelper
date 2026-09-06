import { useMemo } from 'react';
import { peopleOf, useAppStore } from '../store/useAppStore';
import type { Person } from '../types';

/**
 * Participants du groupe courant, avec une **identité de tableau stable**.
 *
 * `peopleOf` construit un tableau neuf à chaque appel. Utilisé directement dans
 * le corps d'un composant, il fait échouer tous les `useMemo` qui en dépendent —
 * et `settle()` se retrouve recalculé à chaque frappe dans le champ de
 * pourboire. Le mémo tient ici, une fois, pour tous les écrans.
 */
export function useGroupPeople(): Person[] {
  const group = useAppStore((s) => s.group);
  return useMemo(() => peopleOf(group), [group]);
}
