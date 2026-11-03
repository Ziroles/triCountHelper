/**
 * Mapping between a `Route` and an address.
 *
 * Without history, the system's back gesture leaves the installed app instead
 * of stepping back one screen — and the rework took the journey from one level
 * to three, which makes the flaw three times as annoying.
 *
 * Parsing is **lenient on read, strict on write**: an unknown or truncated
 * address, or one whose step does not exist, falls back to the home screen
 * rather than opening an inconsistent one. An address may come from a
 * six-month-old bookmark, from a share, or from a typo.
 */

import type { FlowStep } from '../types';
import type { Route } from '../store/useAppStore';

const STEPS: readonly FlowStep[] = ['capture', 'processing', 'verify', 'assign', 'adjust', 'results'];

export const HOME: Route = { name: 'groups' };

function isStep(value: string): value is FlowStep {
  return (STEPS as readonly string[]).includes(value);
}

/** Route → path. Identifiers are encoded: a share code is opaque. */
export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'groups':
      return '/';
    case 'join':
      return '/rejoindre';
    case 'settings':
      return '/reglages';
    case 'group':
      return `/g/${encodeURIComponent(route.groupId)}`;
    case 'receipt':
      return `/g/${encodeURIComponent(route.groupId)}/t/${encodeURIComponent(route.receiptId)}/${route.step}`;
    default:
      return '/';
  }
}

/** Path → route, or the home screen if the path describes nothing known. */
export function pathToRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((part) => part !== '');

  if (parts.length === 0) return HOME;
  if (parts.length === 1 && parts[0] === 'rejoindre') return { name: 'join' };
  if (parts.length === 1 && parts[0] === 'reglages') return { name: 'settings' };

  if (parts[0] === 'g' && parts[1]) {
    const groupId = decodeURIComponent(parts[1]);
    if (parts.length === 2) return { name: 'group', groupId };

    if (parts[2] === 't' && parts[3]) {
      const receiptId = decodeURIComponent(parts[3]);
      const step = parts[4] ?? '';
      // A missing or made-up step: open the receipt at verification, which is
      // usable whatever its stage of progress.
      return {
        name: 'receipt',
        groupId,
        receiptId,
        step: isStep(step) ? step : 'verify',
      };
    }
  }

  return HOME;
}

export function currentRoute(): Route {
  if (typeof window === 'undefined') return HOME;
  return pathToRoute(window.location.pathname);
}

/** Same screen: same address. */
export function sameRoute(a: Route, b: Route): boolean {
  return routeToPath(a) === routeToPath(b);
}

/** What the app keeps in `history.state`: the screen, and the one before it. */
export type HistoryEntry = { route: Route; prev: Route | null };

/** Reads a history entry leniently: an old entry, or another page's, may carry anything. */
export function historyEntry(state: unknown): HistoryEntry | null {
  if (!state || typeof state !== 'object' || !('route' in state)) return null;
  const { route, prev } = state as { route?: unknown; prev?: unknown };
  const valid = (value: unknown): value is Route =>
    !!value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string';
  if (!valid(route)) return null;
  return { route, prev: valid(prev) ? prev : null };
}
