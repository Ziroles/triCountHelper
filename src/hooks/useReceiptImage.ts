import { useEffect, useState } from 'react';
import * as api from '../api';
import { cacheImage, cachedImage } from '../db';

/**
 * Photo d'un ticket, en objet URL prêt pour un `<img>`.
 *
 * Le cache local répond en premier : rouvrir un ticket ne doit pas retélécharger
 * sa photo, ni la faire disparaître hors ligne. Le réseau ne sert qu'à combler
 * ce que le cache n'a pas.
 *
 * `imageId` fait partie des dépendances : une photo reprise change d'identifiant,
 * et c'est ce qui déclenche le rechargement.
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
