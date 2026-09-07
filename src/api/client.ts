/**
 * HTTP client for the SplitTicket API.
 *
 * Two responsibilities, and nothing else: carry the device token, and turn an
 * error response into something a screen can display.
 *
 * Enrolment is automatic and silent: on the first call the device asks for a
 * token and keeps it. The user has no account to create and no password to
 * choose in order to use the app — that is the whole point of the
 * "identity per device" model.
 */

import { getDeviceToken, setDeviceToken } from '../db';
import { logger } from '../lib/log';

const log = logger('api');

const RAW_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
export const API_BASE = (RAW_BASE === '' ? '/api' : RAW_BASE).replace(/\/+$/, '');

const SIGNUP_KEY = ((import.meta.env.VITE_SIGNUP_KEY as string | undefined) ?? '').trim();

/**
 * Version of the HTTP contract this app expects.
 *
 * The API and the PWA ship separately. Without this guard rail, one falling
 * behind the other only shows up when a route answers something other than
 * what was expected — that is, late, and to the user. Bump it at the same time
 * as `CONTRACT_VERSION` on the server side.
 */
export const CONTRACT_VERSION = '1';

/* The first question in front of a failing call is "what was it talking to?".
   Might as well answer it before it gets asked. */
log.info('client ready', { base: API_BASE, contract: CONTRACT_VERSION, signupKey: SIGNUP_KEY !== '' });

/** API error already phrased for the user. */
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
  // FastAPI wraps our errors in `detail`; validation errors put an array in
  // there, which we do not try to translate word for word.
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

/** Token for this device, enrolling it on first request. */
export async function deviceToken(): Promise<string> {
  const existing = await getDeviceToken();
  if (existing) return existing;

  // One enrolment at a time: two screens starting together must not create two
  // devices for a single phone.
  if (enrolling === null) {
    log.info('enrolling this device');
    const done = log.time('enrolment');
    enrolling = (async () => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (SIGNUP_KEY !== '') headers['x-signup-key'] = SIGNUP_KEY;
      const response = await fetch(`${API_BASE}/v1/devices`, { method: 'POST', headers });
      if (!response.ok) {
        const detail = readDetail(await response.json().catch(() => null));
        log.error('enrolment refused', { status: response.status, code: detail.code });
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
      done('device enrolled');
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
  /** Body already built (photo upload): leave the content-type alone. */
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const done = log.time(`${method} ${path}`);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    log.warn(`${method} ${path} — offline, request not attempted`);
    throw new OfflineError();
  }

  const token = await deviceToken();
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  // An internal abort must not cancel the abort the caller asked for: we listen
  // to theirs, we trigger ours.
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
    if (options.signal?.aborted) {
      done('aborted by caller');
      throw error;
    }
    const timedOut = controller.signal.aborted;
    log.error(`${method} ${path} — ${timedOut ? 'timed out' : 'server unreachable'}`, {
      base: API_BASE,
      timeoutMs: options.timeoutMs ?? 30000,
      cause: error,
    });
    throw new ApiError(
      timedOut
        ? 'Le serveur a mis trop de temps à répondre.'
        : 'Le serveur n’a pas pu être joint. Vérifiez la connexion.',
      0,
      timedOut ? 'timeout' : 'network',
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) {
    done('204');
    return undefined as T;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readDetail(payload);
    // A 409 is expected (optimistic lock), a 5xx is not: the level follows that
    // difference, so the terminal can be skimmed.
    const report = response.status >= 500 || response.status === 0 ? log.error : log.warn;
    report(`${method} ${path} → ${response.status}`, {
      code: detail.code,
      reason: detail.reason,
      retryable: detail.retryable,
    });
    throw new ApiError(
      detail.reason ?? messageForStatus(response.status),
      response.status,
      detail.code ?? 'request_failed',
      detail.retryable ?? response.status >= 500,
      detail,
    );
  }
  done(String(response.status));
  return payload as T;
}

export async function requestBlob(path: string): Promise<Blob | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    log.debug(`GET ${path} — offline, no blob`);
    return null;
  }
  const done = log.time(`GET ${path} (blob)`);
  const token = await deviceToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    log.warn(`GET ${path} → ${response.status}, no blob`);
    return null;
  }
  const blob = await response.blob();
  done(`${response.status}, ${Math.round(blob.size / 1024)} KiB`);
  return blob;
}
