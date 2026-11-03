/**
 * Find a Tricount share link inside whatever the user pasted: the bare link,
 * the bare code, or the whole invitation message from the Tricount app.
 *
 * Only the extracted link is sent to the API, never the message around it.
 */

export interface ShareLink {
  /** The tricount code, e.g. `tABC123456`. */
  code: string;
  /** Canonical link sent to the API, without language prefix or `www.`. */
  url: string;
  /** True when the text held more than one distinct link (the first one wins). */
  several: boolean;
}

// Punctuation glued to the link (`.` `,` `)` `!`) stops at the character class.
const LINK = /(?:https?:\/\/)?(?:www\.)?tricount\.com\/(?:[a-z]{2}\/)?(?:t\/)?([A-Za-z0-9]{6,})/gi;
const BARE_CODE = /^[A-Za-z0-9]{6,}$/;

export function extractShareLink(text: string): ShareLink | null {
  const codes: string[] = [];
  for (const match of text.matchAll(LINK)) {
    const code = match[1];
    if (code && !codes.includes(code)) codes.push(code);
  }

  if (codes.length === 0) {
    const trimmed = text.trim();
    if (!BARE_CODE.test(trimmed)) return null;
    codes.push(trimmed);
  }

  const [code = ''] = codes;
  return { code, url: `https://tricount.com/${code}`, several: codes.length > 1 };
}
