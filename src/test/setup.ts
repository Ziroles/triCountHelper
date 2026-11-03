import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { forgetDeviceMemory } from '../lib/deviceMemory';

/* Recent Node versions define their own `localStorage` global, undefined
   without `--localstorage-file`, which hides jsdom's. An in-memory one stands
   in, so code that remembers things in it can be tested. */
if (typeof window !== 'undefined' && !window.localStorage) {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (name) => items.get(name) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (name) => void items.delete(name),
    setItem: (name, value) => void items.set(name, String(value)),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

/* Routing writes to history. Without a reset, a test inherits the address left
   by the previous one and opens the wrong screen. */
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // What the device remembers about receipts must not leak between tests.
  forgetDeviceMemory();
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
