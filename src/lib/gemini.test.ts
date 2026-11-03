import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiError, listModels, readReceipt } from './gemini';
import { describeReadingError } from './errors';
import { ApiError } from '../api';

describe('modèles lisibles avec la clé de l’utilisateur', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('interroge Google directement, clé en en-tête, et ne garde que les modèles de vision', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                supportedGenerationMethods: ['generateContent', 'countTokens'],
              },
              {
                name: 'models/gemini-1.5-pro',
                displayName: 'Gemini 1.5 Pro',
                supportedGenerationMethods: ['generateContent'],
              },
              { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-2.0-embed', supportedGenerationMethods: ['embedContent'] },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await listModels('AIza-ma-cle');

    expect(models).toEqual([
      { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
      { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).not.toContain('AIza-ma-cle');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('AIza-ma-cle');
  });

  it('dit clairement quand Google refuse la clé', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));

    const failure = listModels('mauvaise-cle');

    await expect(failure).rejects.toBeInstanceOf(GeminiError);
    await expect(failure).rejects.toMatchObject({ code: 'key_invalid', retryable: false });
  });
});

describe('erreurs de lecture, en français et précises', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const reply = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  async function failure(): Promise<ReturnType<typeof describeReadingError>> {
    try {
      await readReceipt('cle', 'gemini-2.5-flash', 'AAAA', 'image/jpeg');
    } catch (error) {
      return describeReadingError(error, 'gemini-2.5-flash');
    }
    throw new Error('la lecture aurait dû échouer');
  }

  it('réseau injoignable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await failure()).toMatchObject({ code: 'unreachable', action: 'retry' });
  });

  it('délai dépassé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))),
    );
    expect(await failure()).toMatchObject({ code: 'timeout', action: 'retry' });
  });

  it('clé invalide (400 API_KEY_INVALID)', async () => {
    reply(400, {
      error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
    });
    const error = await failure();
    expect(error).toMatchObject({ code: 'key_invalid', action: 'settings' });
    expect(error.title).toBe('Cette clé Gemini n’est pas valide.');
  });

  it('accès refusé (403)', async () => {
    reply(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
    expect(await failure()).toMatchObject({ code: 'forbidden', action: 'settings' });
  });

  it('modèle introuvable (404), nommé dans le message', async () => {
    reply(404, { error: { code: 404, status: 'NOT_FOUND' } });
    const error = await failure();
    expect(error).toMatchObject({ code: 'model_gone', action: 'settings' });
    expect(error.title).toContain('« gemini-2.5-flash »');
  });

  it('quota par minute (429), avec le délai lu dans RetryInfo', async () => {
    reply(429, {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31.4s' },
        ],
      },
    });
    expect(await failure()).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 32 });
  });

  it('quota journalier (429 PerDay)', async () => {
    reply(429, {
      error: {
        code: 429,
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
      },
    });
    expect(await failure()).toMatchObject({ code: 'daily_quota', action: 'manual' });
  });

  it('image refusée (400 sans raison de clé)', async () => {
    reply(400, { error: { code: 400, message: 'Unable to process input image.' } });
    expect(await failure()).toMatchObject({ code: 'bad_image', action: 'retake' });
  });

  it('réponse bloquée (blockReason ou SAFETY)', async () => {
    reply(200, { promptFeedback: { blockReason: 'OTHER' } });
    expect(await failure()).toMatchObject({ code: 'blocked', action: 'retake' });
    reply(200, { candidates: [{ finishReason: 'SAFETY' }] });
    expect(await failure()).toMatchObject({ code: 'blocked' });
  });

  it('réponse tronquée (MAX_TOKENS)', async () => {
    reply(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"li' }] } }] });
    expect(await failure()).toMatchObject({ code: 'truncated', action: 'retake' });
  });

  it('Google indisponible (503)', async () => {
    reply(503, { error: { code: 503, status: 'UNAVAILABLE' } });
    expect(await failure()).toMatchObject({ code: 'unavailable', action: 'retry' });
  });

  it('lecture par le serveur : libellé choisi d’après le code, pas la phrase', () => {
    const error = describeReadingError(new ApiError('No Gemini key configured', 503, 'no_gemini_key', false));
    expect(error).toMatchObject({ code: 'no_key', action: 'settings' });
    expect(error.title).toBe('Aucune clé Gemini n’est configurée.');
    expect(describeReadingError(new ApiError('Upstream down', 502, 'upstream', true)).code).toBe('unavailable');
  });
});
