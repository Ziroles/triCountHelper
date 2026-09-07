import { useEffect, useState } from 'react';
import * as api from '../api';
import { cacheImage, cachedImage } from '../db';

/**
 * A receipt's photo, as an object URL ready for an `<img>`.
 *
 * The local cache answers first: reopening a receipt must not re-download its
 * photo, nor make it disappear offline. The network only fills in what the
 * cache does not have.
 *
 * `imageId` is one of the dependencies: a retaken photo gets a new identifier,
 * and that is what triggers the reload.
 */
export function useReceiptImage(receiptId: string, imageId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!receiptId || !imageId) {
      setUrl(null);
      return undefined;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    const show = (blob: Blob) => {
      if (cancelled) return false;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      return true;
    };

    void (async () => {
      const cached = await cachedImage(receiptId);
      if (cached && show(cached)) return;
      const fetched = await api.readImage(receiptId).catch(() => null);
      if (fetched) {
        void cacheImage(receiptId, fetched);
        show(fetched);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [receiptId, imageId]);

  return url;
}
