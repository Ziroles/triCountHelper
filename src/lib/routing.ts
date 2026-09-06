/**
 * Correspondance entre une `Route` et une adresse.
 *
 * Sans historique, le geste retour du système quitte l'application installée au
 * lieu de reculer d'un écran — et la refonte a fait passer le parcours de un à
 * trois niveaux, ce qui rend le défaut trois fois plus pénible.
 *
 * Le parsing est **tolérant en lecture, strict en écriture** : une adresse
 * inconnue, tronquée ou dont l'étape n'existe pas retombe sur l'accueil plutôt
 * que d'ouvrir un écran incohérent. Une adresse peut venir d'un signet vieux de
 * six mois, d'un partage, ou d'une faute de frappe.
 */

import type { ReceiptStep } from '../types';
import type { Route } from '../store/useAppStore';

const STEPS: readonly ReceiptStep[] = ['capture', 'processing', 'verify', 'assign', 'results'];

export const HOME: Route = { name: 'groups' };

function isStep(value: string): value is ReceiptStep {
  return (STEPS as readonly string[]).includes(value);
}

/** Route → chemin. Les identifiants sont encodés : un code de partage est opaque. */
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

/** Chemin → route, ou l'accueil si le chemin ne décrit rien de connu. */
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
      // Une étape absente ou inventée : on ouvre le ticket à la vérification,
      // qui est utilisable quel que soit son état d'avancement.
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
