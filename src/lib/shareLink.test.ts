import { describe, expect, it } from 'vitest';
import { extractShareLink } from './shareLink';

const code = (text: string) => extractShareLink(text)?.code ?? null;

describe('extractShareLink', () => {
  it('trouve le lien dans un message français complet', () => {
    const found = extractShareLink(
      'Salut ! Rejoins le tricount « Week-end Lyon » : https://tricount.com/tABC123456',
    );
    expect(found).toEqual({
      code: 'tABC123456',
      url: 'https://tricount.com/tABC123456',
      several: false,
    });
  });

  it('trouve le lien dans un message anglais', () => {
    expect(code('Join my tricount "Trip" here: https://tricount.com/tXYZ987654 See you!')).toBe(
      'tXYZ987654',
    );
  });

  it('écarte la ponctuation collée au lien', () => {
    expect(code('Le lien : https://tricount.com/tABC123456.')).toBe('tABC123456');
    expect(code('(https://tricount.com/tABC123456)')).toBe('tABC123456');
    expect(code('https://tricount.com/tABC123456, merci')).toBe('tABC123456');
    expect(code('https://tricount.com/tABC123456!')).toBe('tABC123456');
  });

  it('accepte www., http:// et l’absence de schéma', () => {
    expect(code('http://www.tricount.com/tABC123456')).toBe('tABC123456');
    expect(code('www.tricount.com/tABC123456')).toBe('tABC123456');
    expect(code('tricount.com/tABC123456')).toBe('tABC123456');
  });

  it('retire le préfixe de langue et renvoie un lien canonique', () => {
    expect(extractShareLink('https://tricount.com/fr/tABC123456')?.url).toBe(
      'https://tricount.com/tABC123456',
    );
    expect(code('https://www.tricount.com/en/t/tABC123456')).toBe('tABC123456');
  });

  it('trouve un lien après un retour à la ligne', () => {
    expect(code('Rejoins-nous sur Tricount\nhttps://tricount.com/tABC123456')).toBe('tABC123456');
  });

  it('prend le premier de plusieurs liens et le signale', () => {
    const found = extractShareLink(
      'https://tricount.com/tAAA111111 ou https://tricount.com/tBBB222222',
    );
    expect(found?.code).toBe('tAAA111111');
    expect(found?.several).toBe(true);
  });

  it('ne signale pas deux fois le même lien comme plusieurs', () => {
    expect(
      extractShareLink('https://tricount.com/tAAA111111 (https://tricount.com/tAAA111111)')
        ?.several,
    ).toBe(false);
  });

  it('accepte un code seul', () => {
    expect(extractShareLink('  tABC123456 \n')?.url).toBe('https://tricount.com/tABC123456');
  });

  it('renvoie null sans lien', () => {
    expect(extractShareLink('')).toBeNull();
    expect(extractShareLink('Salut, ça va ?')).toBeNull();
    expect(extractShareLink('https://example.com/tABC123456')).toBeNull();
    expect(extractShareLink('abc')).toBeNull();
  });
});
