import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

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

  /* The array feeds the `useMemo` dependencies around `settle()`. A fresh
     identity on every render would recompute the whole split on every keystroke
     in the tip field. */
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
    act(() => useAppStore.setState({ group: { ...group, title: 'Voyage' } }));
    rerender();
    expect(result.current).not.toBe(first);
  });
});
