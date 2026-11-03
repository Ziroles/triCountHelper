/**
 * Suggested assignments: prefilling the dishes the way the group usually
 * hands them out (see the API's `suggestions.py`).
 *
 * Offered once per reading (`suggestedAt`): a dish left to everyone on purpose
 * is not refilled behind the user's back. The dishes that still carry the
 * suggestion are listed (`suggestedLineIds`), so the screen can mark them and
 * undo them — and a dish the user touches is theirs again.
 */

import type { Person, Receipt, SuggestedLine } from '../types';

/** Whether this receipt still has to be offered suggestions. */
export function wantsSuggestions(receipt: Receipt, people: readonly Person[]): boolean {
  return (
    !receipt.suggestedAt &&
    people.length > 0 &&
    receipt.lines.some((line) => line.assignments.length === 0)
  );
}

/**
 * Prefills the dishes nobody has taken yet. A dish taken in the meantime, or a
 * suggestion whose people have all left the tricount, is skipped. Marks the
 * receipt as offered even when nothing applied: there is nothing to ask again.
 */
export function applySuggestions(
  receipt: Receipt,
  suggestions: readonly SuggestedLine[],
  people: readonly Person[],
  now: string,
): Receipt {
  const known = new Set(people.map((person) => person.id));
  const byLine = new Map(suggestions.map((suggestion) => [suggestion.lineId, suggestion]));
  const applied: string[] = [];

  const lines = receipt.lines.map((line) => {
    const suggestion = byLine.get(line.id);
    if (!suggestion || line.assignments.length > 0) return line;
    const assignments = suggestion.assignments.filter(
      (assignment) => known.has(assignment.personId) && assignment.shares > 0,
    );
    if (assignments.length === 0) return line;
    applied.push(line.id);
    return { ...line, assignments };
  });

  return { ...receipt, lines, suggestedAt: now, suggestedLineIds: applied };
}

/** The user took these dishes in hand: they no longer carry the suggestion. */
export function dropSuggested(receipt: Receipt, lineIds: readonly string[]): Receipt {
  const current = receipt.suggestedLineIds ?? [];
  if (!current.some((id) => lineIds.includes(id))) return receipt;
  return { ...receipt, suggestedLineIds: current.filter((id) => !lineIds.includes(id)) };
}

/** Undo: the suggested dishes go back to nobody — that is, to everyone. */
export function undoSuggestions(receipt: Receipt): Receipt {
  const suggested = new Set(receipt.suggestedLineIds ?? []);
  if (suggested.size === 0) return receipt;
  return {
    ...receipt,
    lines: receipt.lines.map((line) =>
      suggested.has(line.id) ? { ...line, assignments: [] } : line,
    ),
    suggestedLineIds: [],
  };
}
