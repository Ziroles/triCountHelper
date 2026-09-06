import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

/* Le routage écrit dans l'historique. Sans remise à zéro, un test hérite de
   l'adresse laissée par le précédent et ouvre le mauvais écran. */
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
