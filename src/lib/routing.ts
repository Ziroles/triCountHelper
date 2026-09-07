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

import type { ReceiptStep } from '../types';
import type { Route } from '../store/useAppStore';

const STEPS: readonly ReceiptStep[] = ['capture', 'processing', 'verify', 'assign', 'results'];

export const HOME: Route = { name: 'groups' };

function isStep(value: string): value is ReceiptStep {
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
