import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';

type PhotoSourceSheetProps = {
  open: boolean;
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
};

/**
 * Explicit choice between camera and gallery.
 *
 * Without it, the browser decides: Android often shows a menu, but some
 * browsers go straight to the gallery. Two buttons work everywhere.
 */
export function PhotoSourceSheet({ open, onClose, onCamera, onGallery }: PhotoSourceSheetProps) {
  return (
    <Sheet open={open} title="Photo du ticket" onClose={onClose}>
      <ul className="menu">
        <li>
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              onClose();
              onCamera();
            }}
          >
            Prendre une photo
          </button>
        </li>
        <li>
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              onClose();
              onGallery();
            }}
          >
            Choisir dans la galerie
          </button>
        </li>
      </ul>
    </Sheet>
  );
}

/**
 * Whether the device has a camera: `true`, `false`, or `null` when unknown.
 * Unknown keeps the sheet, which is the safe side: a computer without a camera
 * is the only case where the choice is pointless.
 */
export function useHasCamera(): boolean | null {
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (typeof devices?.enumerateDevices !== 'function') return undefined;
    let cancelled = false;
    devices
      .enumerateDevices()
      .then((list) => {
        if (!cancelled) setHasCamera(list.some((device) => device.kind === 'videoinput'));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return hasCamera;
}
