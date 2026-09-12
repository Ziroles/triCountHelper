/**
 * Reading a receipt, called **from this browser**, with the user's own key.
 *
 * The key never reaches the SplitTicket API — not stored in the clear, not in
 * transit, not in its memory. It goes from here to Google and nowhere else.
 * What we send back to the API is the model's raw answer, which it sanitises
 * exactly as it sanitised its own before: `normalize_extraction` did not have
 * to change, because that text was never trusted in the first place.
 *
 * Plain `fetch` rather than the Google SDK, deliberately: one request, a schema
 * and a prompt: a dependency would buy nothing and weigh on every load.
 *
 * A key used from here can be **restricted by HTTP referrer** in the Google
 * console — a protection that only exists for browser calls, and the reason
 * this arrangement is more than a lateral move.
 */

import { logger } from './log';

const log = logger('gemini');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

const PROMPT = `You are reading a photographed Canadian till receipt. Return its contents as JSON.

━━ COMPLETENESS — top priority ━━
Go through the receipt from top to bottom without skipping a single item line.
- One entry in "lines" per item line, in the exact order.
- "label": the label exactly as printed on the receipt (abbreviations included).
- "description": a clear, intelligible description of the product in English (e.g. decode "CR GCE VAN" as "Vanilla ice cream", "PQ CHARMIN 12" as "Charmin toilet paper, 12 rolls", "POM MCINT SAC" as "Bag of McIntosh apples", "CSHG CANETTE" as "Can deposit"). If the name is already clear, simply restate it concisely without inventing information.
- If a line is blurry or partly illegible, give your best reading and set "uncertain": true. Never drop a line on the grounds that it is illegible.
- Before answering, check that the sum of all your "total" values matches the printed subtotal. If there is a gap, look for the missing lines.

━━ AMOUNTS ━━
- Returned exactly as printed, as a string: "12,90" or "12.90" depending on the receipt, without a currency symbol.
- Item prices are read as printed — they already include any discount.
- "total" = the line total, quantity included. "unitPrice" = the price per unit. "quantity" = 1 if not stated.

━━ LINES TO EXCLUDE FROM "lines" ━━
Do NOT put in "lines": discounts/rebates (rabais, remise), container deposits (consigne), SUBTOTAL/SOUS-TOTAL, TOTAL, GST/TPS, QST/TVQ, HST/TVH, PST/TVP, cash/comptant, debit/débit, credit/crédit, INTERAC, change given/monnaie rendue, THANK YOU/MERCI, item count, loyalty points, total savings, card balance, transaction number.

━━ TAXABLE — Canadian rules ━━
In Canada (Quebec, Ontario, etc.), basic groceries are EXEMPT from GST and QST/PST:
  • Exempt (taxable: false): vegetables, fruit, meat, fish, dairy (milk, cheese, plain yogurt), bread, cereals, eggs, pure fruit juice.
  • Taxable (taxable: true): alcoholic drinks (beer, wine, spirits), candy, chips/crisps, sugary/energy drinks, non-food items, prepared/hot ready-to-eat meals.
  • Ambiguous: if a marker (T, *, F, P, A or another code) is printed at the end of the line → taxable: true. With no marker and no doubt → follow the rules above. If you are genuinely unsure, omit the field.

━━ OTHER FIELDS ━━
- "taxes": each tax line at the foot of the receipt — "label" as printed, "rate" if present (e.g. "5"), "amount".
- "subtotal": the pre-tax subtotal printed on the receipt.
- "total" (at the root): the amount due.
- "purchaseDate": YYYY-MM-DD format, empty if absent.`;

/* Amounts are asked for as STRINGS, never numbers: the model writes "12,90",
   and it is the API's `parse_amount_to_cents` that decides what that is worth.
   No float produced by a language model ever touches money. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING' },
    purchaseDate: { type: 'STRING' },
    subtotal: { type: 'STRING' },
    total: { type: 'STRING' },
    taxes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { label: { type: 'STRING' }, rate: { type: 'STRING' }, amount: { type: 'STRING' } },
        required: ['label', 'amount'],
      },
    },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          description: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unitPrice: { type: 'STRING' },
          total: { type: 'STRING' },
          taxable: { type: 'BOOLEAN' },
          uncertain: { type: 'BOOLEAN' },
        },
        required: ['label', 'total'],
      },
    },
  },
  required: ['lines'],
};

function messageForStatus(status: number): string {
  if (status === 400 || status === 401 || status === 403)
    return 'Google refused the key. Check it in the settings.';
  if (status === 429) return 'Your Gemini quota is exhausted. Try again in a moment.';
  if (status >= 500) return 'Google is not answering right now. Try again in a moment.';
  return 'The reading failed.';
}

/**
 * Photo → the model's raw answer, to be handed to the API for sanitising.
 *
 * We deliberately do not parse it here. The parsing, the amount handling and
 * the Canadian tax rules are tested on the API side, and duplicating them in
 * the client is how two implementations start disagreeing.
 */
export async function readReceipt(
  apiKey: string,
  model: string,
  imageBase64: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const done = log.time('gemini read');
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        /* In a header, not in `?key=`: a URL ends up in browser history and can
           travel in a Referer. A header does neither. */
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (error) {
    log.error('gemini unreachable', error);
    throw new GeminiError(
      'Could not reach Google. Check your connection.',
      'unreachable',
      true,
    );
  }

  if (!response.ok) {
    log.warn('gemini refused', { status: response.status });
    throw new GeminiError(
      messageForStatus(response.status),
      response.status === 429 ? 'quota' : 'refused',
      response.status === 429 || response.status >= 500,
    );
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (text.trim() === '') {
    throw new GeminiError('The receipt could not be read from this photo.', 'empty', true);
  }

  done('read', { characters: text.length });
  return text;
}

/* Same filter as the API's `list_models`: the vision-capable families. */
const MULTIMODAL_PREFIXES = ['gemini-1.5', 'gemini-2', 'gemini-3', 'gemini-flash', 'gemini-pro'];

/**
 * Models this key can read a receipt with — asked of Google directly.
 *
 * This is what checks a personal key. The API's `/v1/models` only knows the
 * instance key: asking it about a key it has never seen answers for the wrong
 * one, or "no key" when the instance has none.
 */
export async function listModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ name: string; displayName: string }[]> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?pageSize=1000`, {
      signal,
      headers: { 'x-goog-api-key': apiKey },
    });
  } catch (error) {
    log.error('gemini unreachable', error);
    throw new GeminiError('Could not reach Google. Check your connection.', 'unreachable', true);
  }

  if (!response.ok) {
    log.warn('gemini refused the model listing', { status: response.status });
    throw new GeminiError(
      messageForStatus(response.status),
      response.status === 429 ? 'quota' : 'refused',
      response.status === 429 || response.status >= 500,
    );
  }

  const body = (await response.json()) as {
    models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return (body.models ?? [])
    .filter(
      (entry) =>
        entry.supportedGenerationMethods === undefined ||
        entry.supportedGenerationMethods.includes('generateContent'),
    )
    .map((entry) => {
      const name = (entry.name ?? '').replace(/^models\//, '');
      return { name, displayName: entry.displayName || name };
    })
    .filter((entry) => MULTIMODAL_PREFIXES.some((prefix) => entry.name.startsWith(prefix)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
