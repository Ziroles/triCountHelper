/**
 * What a failed reading means, in French, and what to do about it.
 *
 * One table for both paths — the user's own key (`GeminiError`) and the API's
 * key (`ApiError`): the message is chosen from a stable `code`, never from the
 * English sentence Google or the API wrote.
 */

import { ApiError } from '../api';

export type ReadingAction = 'retry' | 'settings' | 'retake' | 'manual';

export type ReadingErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'key_invalid'
  | 'forbidden'
  | 'model_gone'
  | 'rate_limited'
  | 'daily_quota'
  | 'bad_image'
  | 'blocked'
  | 'truncated'
  | 'unavailable'
  | 'empty'
  | 'no_key'
  | 'image_missing'
  | 'unknown';

export type ReadingError = {
  code: ReadingErrorCode;
  title: string;
  detail: string;
  action: ReadingAction;
  /** Label of the button for `action`. */
  actionLabel: string;
  /** Seconds to wait before trying again, when Google said so. */
  retryAfterSeconds: number | null;
};

type Entry = { title: string; detail: string; action: ReadingAction };

const ACTION_LABELS: Record<ReadingAction, string> = {
  retry: 'Réessayer',
  settings: 'Ouvrir les réglages',
  retake: 'Reprendre la photo',
  manual: 'Saisir à la main',
};

function table(model: string | null): Record<ReadingErrorCode, Entry> {
  return {
    unreachable: {
      title: 'Impossible de joindre Google.',
      detail: 'Vérifiez votre connexion, puis réessayez.',
      action: 'retry',
    },
    timeout: {
      title: 'Google met trop de temps à répondre.',
      detail: 'La lecture a été interrompue après 60 secondes. Réessayez dans un moment.',
      action: 'retry',
    },
    key_invalid: {
      title: 'Cette clé Gemini n’est pas valide.',
      detail: 'Vérifiez-la dans les réglages : elle a pu être mal copiée, ou supprimée.',
      action: 'settings',
    },
    forbidden: {
      title: 'Cette clé n’a pas accès à Gemini depuis ce site.',
      detail:
        'L’API Gemini n’est pas activée pour ce projet Google, ou la clé est restreinte à d’autres sites (restriction de référent).',
      action: 'settings',
    },
    model_gone: {
      title: `Le modèle ${model ? `« ${model} » ` : ''}n’est plus disponible.`,
      detail: 'Choisissez un autre modèle dans les réglages.',
      action: 'settings',
    },
    rate_limited: {
      title: 'Trop de lectures d’un coup.',
      detail: 'Google limite le nombre de lectures par minute. Patientez un peu.',
      action: 'retry',
    },
    daily_quota: {
      title: 'Le quota du jour de cette clé est épuisé.',
      detail: 'Il se renouvelle demain. D’ici là, les lignes peuvent être saisies à la main.',
      action: 'manual',
    },
    bad_image: {
      title: 'Google n’a pas pu ouvrir cette photo.',
      detail: 'Elle est peut-être trop lourde ou dans un format inhabituel. Reprenez-la.',
      action: 'retake',
    },
    blocked: {
      title: 'Google a refusé de lire cette image.',
      detail: 'Reprenez la photo en ne cadrant que le ticket.',
      action: 'retake',
    },
    truncated: {
      title: 'Ticket trop long pour une seule lecture.',
      detail: 'Recadrez la photo sur une partie du ticket, puis ajoutez le reste à la main.',
      action: 'retake',
    },
    unavailable: {
      title: 'Google est indisponible pour le moment.',
      detail: 'Le service ne répond pas. Réessayez dans quelques minutes.',
      action: 'retry',
    },
    empty: {
      title: 'Aucune ligne n’a pu être lue.',
      detail: 'La photo est peut-être floue. Reprenez-la, ou saisissez les lignes à la main.',
      action: 'retake',
    },
    no_key: {
      title: 'Aucune clé Gemini n’est configurée.',
      detail: 'Ajoutez votre clé dans les réglages pour lire les tickets.',
      action: 'settings',
    },
    image_missing: {
      title: 'La photo de ce ticket n’est plus disponible.',
      detail: 'Reprenez-la, ou saisissez les lignes à la main.',
      action: 'retake',
    },
    unknown: {
      title: 'La lecture n’a pas abouti.',
      detail: 'Réessayez, ou saisissez les lignes à la main.',
      action: 'retry',
    },
  };
}

/** A refusal from Google, on the user's own key. */
export class GeminiError extends Error {
  constructor(
    readonly code: ReadingErrorCode,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(table(null)[code].title);
    this.name = 'GeminiError';
  }
}

const KNOWN = new Set<string>(Object.keys(table(null)));

/** API codes that do not share a name with ours. */
const API_ALIASES: Record<string, ReadingErrorCode> = {
  no_gemini_key: 'no_key',
  offline: 'unreachable',
  gemini_quota: 'rate_limited',
  quota: 'rate_limited',
};

function codeOf(error: unknown): { code: ReadingErrorCode; retryAfterSeconds: number | null } {
  if (error instanceof GeminiError) {
    return { code: error.code, retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof ApiError) {
    const alias = API_ALIASES[error.code];
    if (alias) return { code: alias, retryAfterSeconds: null };
    if (KNOWN.has(error.code)) return { code: error.code as ReadingErrorCode, retryAfterSeconds: null };
    if (error.status === 0) return { code: 'unreachable', retryAfterSeconds: null };
    if (error.status === 429) return { code: 'rate_limited', retryAfterSeconds: null };
    if (error.status >= 500) return { code: 'unavailable', retryAfterSeconds: null };
  }
  return { code: 'unknown', retryAfterSeconds: null };
}

export function describeReadingError(error: unknown, model: string | null = null): ReadingError {
  const { code, retryAfterSeconds } = codeOf(error);
  const entry = table(model)[code];
  return {
    code,
    ...entry,
    actionLabel: ACTION_LABELS[entry.action],
    retryAfterSeconds,
  };
}
