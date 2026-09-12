import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiError, listModels } from './gemini';

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
    await expect(failure).rejects.toMatchObject({ code: 'refused', retryable: false });
  });
});
