import { describe, expect, it } from 'vitest';
import { HOME, pathToRoute, routeToPath } from './routing';
import type { Route } from '../store/useAppStore';

const routes: Route[] = [
  { name: 'groups' },
  { name: 'join' },
  { name: 'settings' },
  { name: 'group', groupId: 'tABC123456' },
  { name: 'receipt', groupId: 'tABC123456', receiptId: 'r-1', step: 'capture' },
  { name: 'receipt', groupId: 'tABC123456', receiptId: 'r-1', step: 'results' },
];

describe('adresses', () => {
  it.each(routes)('fait l’aller-retour pour $name', (route) => {
    expect(pathToRoute(routeToPath(route))).toEqual(route);
  });

  it('donne des adresses lisibles', () => {
    expect(routeToPath({ name: 'groups' })).toBe('/');
    expect(routeToPath({ name: 'group', groupId: 'tABC' })).toBe('/g/tABC');
    expect(
      routeToPath({ name: 'receipt', groupId: 'tABC', receiptId: 'r1', step: 'assign' }),
    ).toBe('/g/tABC/t/r1/assign');
  });

  it('encode les identifiants, qui sont opaques', () => {
    const route: Route = { name: 'group', groupId: 'a/b c' };
    expect(routeToPath(route)).toBe('/g/a%2Fb%20c');
    expect(pathToRoute(routeToPath(route))).toEqual(route);
  });

  /* An address may come from a six-month-old bookmark, from a share or from a
     typo: it must land on its feet, not open an inconsistent screen. */
  it.each(['/inconnu', '/g', '/g/', '/x/tABC', '/g/tABC/t', '/g/tABC/z/r1'])(
    'retombe sur l’accueil pour « %s »',
    (path) => {
      expect(pathToRoute(path)).toEqual(HOME);
    },
  );

  it('ouvre à la vérification quand l’étape est absente ou inventée', () => {
    expect(pathToRoute('/g/tABC/t/r1')).toEqual({
      name: 'receipt',
      groupId: 'tABC',
      receiptId: 'r1',
      step: 'verify',
    });
    expect(pathToRoute('/g/tABC/t/r1/pizza')).toMatchObject({ step: 'verify' });
  });

  it('tolère une barre oblique finale', () => {
    expect(pathToRoute('/g/tABC/')).toEqual({ name: 'group', groupId: 'tABC' });
    expect(pathToRoute('//')).toEqual(HOME);
  });
});
