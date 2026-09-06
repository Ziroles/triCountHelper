/**
 * Client HTTP de l'API SplitTicket.
 *
 * Deux responsabilités, et rien d'autre : porter le jeton d'appareil, et
 * transformer une réponse d'erreur en quelque chose qu'un écran peut afficher.
 *
 * L'enrôlement est automatique et silencieux : au premier appel, l'appareil
 * demande un jeton et le garde. L'utilisateur n'a ni compte à créer ni mot de
 * passe à choisir pour se servir de l'application — c'est le point du modèle
 * « identité par appareil ».
 */

import { getDeviceToken, setDeviceToken } from '../db';

const RAW_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
export const API_BASE = (RAW_BASE === '' ? '/api' : RAW_BASE).replace(/\/+$/, '');

const SIGNUP_KEY = ((import.meta.env.VITE_SIGNUP_KEY as string | undefined) ?? '').trim();

/**
 * Version du contrat HTTP attendue par cette application.
 *
 * L'API et la PWA se déploient séparément. Sans ce garde-fou, une version en
 * retard sur l'autre ne se remarque qu'au moment où une route répond autre
 * chose que prévu — c'est-à-dire tard, et à l'utilisateur. À incrémenter en
 * même temps que `CONTRACT_VERSION` côté serveur.
 */
export const CONTRACT_VERSION = '1';

/** Erreur d'API déjà formulée pour l'utilisateur. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class OfflineError extends ApiError {
  constructor() {
    super(
      'Cette action a besoin du réseau. Reconnectez-vous pour continuer.',
      0,
      'offline',
      true,
    );
    this.name = 'OfflineError';
  }
}

type Detail = { code?: string; reason?: string; retryable?: boolean; [key: string]: unknown };

function readDetail(body: unknown): Detail {
  if (typeof body !== 'object' || body === null) return {};
  const record = body as Record<string, unknown>;
  // FastAPI enveloppe nos erreurs dans `detail` ; les erreurs de validation y
  // mettent un tableau, qu'on ne cherche pas à traduire mot à mot.
  const detail = record.detail ?? record;
  if (Array.isArray(detail)) return { code: 'invalid_request', reason: 'Requête invalide.' };
  return typeof detail === 'object' && detail !== null ? (detail as Detail) : {};
}

function messageForStatus(status: number): string {
  if (status === 401) return 'Cet appareil n’est plus reconnu par le serveur.';
  if (status === 404) return 'Introuvable.';
  if (status === 409) return 'Quelqu’un est passé avant vous.';
  if (status === 413) return 'Fichier trop lourd.';
  if (status === 429) return 'Trop de demandes. Réessayez dans un moment.';
  if (status >= 500) return 'Le serveur est momentanément indisponible.';
  return 'La demande n’a pas abouti.';
}

let enrolling: Promise<string> | null = null;

/** Jeton de cet appareil, en l'enrôlant à la première demande. */
export async function deviceToken(): Promise<string> {
  const existing = await getDeviceToken();
  if (existing) return existing;

  // Un seul enrôlement à la fois : deux écrans qui démarrent ensemble ne
  // doivent pas créer deux appareils pour un seul téléphone.
  if (enrolling === null) {
    enrolling = (async () => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (SIGNUP_KEY !== '') headers['x-signup-key'] = SIGNUP_KEY;
      const response = await fetch(`${API_BASE}/v1/devices`, { method: 'POST', headers });
      if (!response.ok) {
        const detail = readDetail(await response.json().catch(() => null));
        throw new ApiError(
          detail.reason ??
            (response.status === 401
              ? 'Cette instance est fermée : une clé d’inscription est nécessaire.'
              : messageForStatus(response.status)),
          response.status,
          detail.code ?? 'enrolment_failed',
          false,
        );
      }
      const body = (await response.json()) as { token: string };
      await setDeviceToken(body.token);
      return body.token;
    })().finally(() => {
      enrolling = null;
    });
  }
  return enrolling;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Corps déjà formé (upload de photo) : on ne touche pas au content-type. */
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new OfflineError();

  const token = await deviceToken();
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  // Un abandon interne ne doit pas annuler l'abandon demandé par l'appelant :
  // on écoute le sien, on déclenche le nôtre.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? 'Le serveur a mis trop de temps à répondre.'
        : 'Le serveur n’a pas pu être joint. Vérifiez la connexion.',
      0,
      controller.signal.aborted ? 'timeout' : 'network',
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readDetail(payload);
    throw new ApiError(
      detail.reason ?? messageForStatus(response.status),
      response.status,
      detail.code ?? 'request_failed',
      detail.retryable ?? response.status >= 500,
      detail,
    );
  }
  return payload as T;
}

export async function requestBlob(path: string): Promise<Blob | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const token = await deviceToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return response.ok ? await response.blob() : null;
}
