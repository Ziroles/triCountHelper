import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, requestBlob } from './client';
import { forgetEverything, getDeviceToken, setDeviceToken } from '../db';

type Call = { url: string; token: string | null; body: unknown };
type Route = (url: string, token: string | null) => Response | undefined;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unknownDevice = (): Response =>
  json(401, { detail: { code: 'unauthenticated', reason: 'Unknown device. Enrol it again.' } });

let calls: Call[];
let knownTokens: Set<string>;
let enrolments: number;

/* A server that knows only the tokens it handed out itself — as one whose
   database was just reset. */
function fakeServer(route?: Route): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? null;
      calls.push({ url, token, body: init?.body });
      if (url.endsWith('/v1/devices')) {
        enrolments++;
        const fresh = `token-${enrolments}`;
        knownTokens.add(fresh);
        return json(201, { deviceId: `device-${enrolments}`, token: fresh });
      }
      const answer = route?.(url, token);
      if (answer) return answer;
      if (token === null || !knownTokens.has(token)) return unknownDevice();
      return json(200, { ok: true, token });
    }),
  );
}

describe('appareil que le serveur ne connaît plus', () => {
  beforeEach(async () => {
    await forgetEverything();
    calls = [];
    knownTokens = new Set();
    enrolments = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('réinscrit l’appareil et rejoue la requête, corps compris', async () => {
    await setDeviceToken('stale-token');
    fakeServer();

    const result = await request('/v1/me/settings', { method: 'PUT', body: { geminiModel: 'm' } });

    expect(result).toEqual({ ok: true, token: 'token-1' });
    expect(await getDeviceToken()).toBe('token-1');
    expect(calls.map((call) => [call.url, call.token, call.body])).toEqual([
      ['/api/v1/me/settings', 'stale-token', '{"geminiModel":"m"}'],
      ['/api/v1/devices', null, undefined],
      ['/api/v1/me/settings', 'token-1', '{"geminiModel":"m"}'],
    ]);
  });

  it('laisse passer un mauvais mot de passe sans toucher à l’appareil', async () => {
    await setDeviceToken('token-known');
    knownTokens.add('token-known');
    fakeServer((url) =>
      url.endsWith('/v1/sessions')
        ? json(401, { detail: { code: 'bad_credentials', reason: 'Incorrect address or password.' } })
        : undefined,
    );

    await expect(
      request('/v1/sessions', { method: 'POST', body: { email: 'a@b.c', proof: 'x' } }),
    ).rejects.toMatchObject({ status: 401, code: 'bad_credentials' });
    expect(enrolments).toBe(0);
    expect(await getDeviceToken()).toBe('token-known');
  });

  it('ne réessaie qu’une fois', async () => {
    await setDeviceToken('stale-token');
    fakeServer((url) => (url.endsWith('/v1/me') ? unknownDevice() : undefined));

    await expect(request('/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(enrolments).toBe(1);
    expect(calls.filter((call) => call.url.endsWith('/v1/me'))).toHaveLength(2);
  });

  it('n’inscrit qu’un appareil quand plusieurs requêtes tombent sur le même jeton mort', async () => {
    await setDeviceToken('stale-token');
    fakeServer();

    await Promise.all([request('/v1/me'), request('/v1/groups'), request('/v1/models')]);

    expect(enrolments).toBe(1);
    expect(await getDeviceToken()).toBe('token-1');
  });

  it('vaut aussi pour les photos', async () => {
    await setDeviceToken('stale-token');
    fakeServer((url, token) =>
      url.endsWith('/image') && token === 'token-1' ? new Response('jpeg', { status: 200 }) : undefined,
    );

    expect(await requestBlob('/v1/receipts/r1/image')).not.toBeNull();
    expect(enrolments).toBe(1);
  });
});
