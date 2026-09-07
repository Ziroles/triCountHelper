import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

/* Routing writes to history. Without a reset, a test inherits the address left
   by the previous one and opens the wrong screen. */
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
