import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../api', () => import('../test/fakeApi'));

import { useGroupPeople } from './useGroupPeople';
import { useAppStore } from '../store/useAppStore';
import type { Group } from '../types';

const group: Group = {
  id: 'g1',
  title: 'Colocation',
  currency: 'CAD',
  members: [
    { uuid: 'm-1', displayName: 'Mathieu', status: 'ACTIVE' },
    { uuid: 'm-2', displayName: 'Léa', status: 'ACTIVE' },
  ],
  membersSyncedAt: null,
  receiptCount: 0,
  lastActivityAt: null,
};

describe('participants du groupe', () => {
  beforeEach(() => {
    useAppStore.setState({ group });
  });

  it('traduit les membres du tricount en participants', () => {
    const { result } = renderHook(() => useGroupPeople());
    expect(result.current.map((p) => [p.id, p.name])).toEqual([
      ['m-1', 'Mathieu'],
      ['m-2', 'Léa'],
    ]);
  });

  /* Le tableau alimente les dépendances de `useMemo` autour de `settle()`.
     Une identité neuve à chaque rendu ferait recalculer toute la répartition
     à chaque frappe dans le champ de pourboire. */
  it('garde la même identité de tableau tant que le groupe ne change pas', () => {
    const { result, rerender } = renderHook(() => useGroupPeople());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it('en rend un nouveau quand le groupe change', () => {
    const { result, rerender } = renderHook(() => useGroupPeople());
    const first = result.current;
    useAppStore.setState({ group: { ...group, title: 'Voyage' } });
    rerender();
    expect(result.current).not.toBe(first);
  });
});
