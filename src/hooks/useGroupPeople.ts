import { useMemo } from 'react';
import { peopleOf, useAppStore } from '../store/useAppStore';
import type { Person } from '../types';

/**
 * The current group's participants, with a **stable array identity**.
 *
 * `peopleOf` builds a fresh array on every call. Used directly in a component
 * body, it breaks every `useMemo` that depends on it — and `settle()` ends up
 * recomputed on every keystroke in the tip field. The memo lives here, once,
 * for every screen.
 */
export function useGroupPeople(): Person[] {
  const group = useAppStore((s) => s.group);
  return useMemo(() => peopleOf(group), [group]);
}
