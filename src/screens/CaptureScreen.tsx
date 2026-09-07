import { useEffect, useRef, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { CropBox } from '../ui/CropBox';
import {
  FULL_CROP,
  downscaleForUpload,
  normalizeCapture,
  rotateImage,
  type CropRect,
  type Rotation,
} from '../capture/image';
import * as api from '../api';
import { cacheImage, cachedImage } from '../db';
import { logger } from '../lib/log';
import { useAppStore } from '../store/useAppStore';
import type { Receipt } from '../types';

const log = logger('photo');

type CaptureScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onDone: () => void;
  /** Go back to verification without re-running the reading, when it already happened. */
  onSkip?: (() => void) | undefined;
  /** Skip the photo and enter the receipt by hand. */
  onManual: () => void;
};

/**
 * Receipt photo: framing, rotation, upload.
 *
 * Cropping and downscaling stay **client-side**, before the upload. It is the
 * only way to send nothing but a sharp, light receipt over a mobile network: an
 * 8 Mpx photo rarely gets through a metro tunnel well, and the useful part is
 * often less than a third of it.
 */
export function CaptureScreen({ receipt, onBack, onDone, onSkip, onManual }: CaptureScreenProps) {
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const online = useAppStore((s) => s.online);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [restored, setRestored] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const userPicked = useRef(false);

  /* The receipt keeps its photo: coming back to this screen puts it back in
     front of the user rather than showing an empty drop zone. */
  const imageId = receipt.imageId;
  useEffect(() => {
    if (!imageId) return undefined;
    let cancelled = false;
    void (async () => {
      const blob = (await cachedImage(receipt.id)) ?? (await api.readImage(receipt.id).catch(() => null));
      // A photo picked in the meantime wins over the one sleeping in the cache.
      if (cancelled || !blob || userPicked.current) return;
      void cacheImage(receipt.id, blob);
      setOriginal(blob);
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [imageId, receipt.id]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!original) {
      setPreview(null);
      return undefined;
    }
    void (async () => {
      const rotated = await rotateImage(original, rotation);
      if (cancelled) return;
      const url = URL.createObjectURL(rotated);
      revoked = url;
      setPreview(url);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [original, rotation]);

  const accept = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError("Ce fichier n'est pas une image.");
      return;
    }
    log.info('photo picked', {
      name: file.name,
      type: file.type,
      size: `${Math.round(file.size / 1024)} KiB`,
    });
    setError(null);
    userPicked.current = true;
    setRestored(false);
    setOriginal(file);
    setRotation(0);
    setCrop(FULL_CROP);
  };

  const confirm = async () => {
    if (!original) return;
    setBusy(true);
    setError(null);
    /* Every step divides the weight; this is the path we suspect first when an
       upload drags or a server answers 413. The sizes make that suspicion
       checkable instead of leaving it a hypothesis. */
    const done = log.time(`preparing and uploading receipt ${receipt.id}`);
    const kib = (blob: Blob) => Math.round(blob.size / 1024);
    try {
      const rotated = await rotateImage(original, rotation);
      const { blob, width, height } = await normalizeCapture(rotated, { crop });
      // One last downscale right before the upload: this is what the model will
      // receive, so it may as well be what goes over the network.
      const upload = await downscaleForUpload(blob);
      log.debug('image prepared', {
        rotation,
        crop,
        original: `${kib(original)} KiB`,
        cropped: `${width}×${height}, ${kib(blob)} KiB`,
        uploaded: `${kib(upload)} KiB`,
      });
      const saved = await api.uploadImage(receipt.id, upload);
      void cacheImage(receipt.id, upload);
      done(`photo accepted, version ${saved.version}`);
      updateReceipt({ ...saved, step: 'processing' });
      onDone();
    } catch (cause) {
      log.error('photo upload failed', cause);
      setError(
        cause instanceof Error
          ? cause.message
          : "L'image n'a pas pu être envoyée. Réessayez avec une autre photo.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Photo du ticket"
      onBack={onBack}
      footer={
        preview ? (
          <>
            <Button variant="primary" full disabled={busy || !online} onClick={() => void confirm()}>
              {busy ? 'Envoi…' : restored ? 'Relire le ticket' : 'Lire le ticket'}
            </Button>
            {onSkip ? (
              <button type="button" className="linkButton linkButton--center" onClick={onSkip}>
                Garder la lecture actuelle
              </button>
            ) : null}
            <button
              type="button"
              className="linkButton linkButton--center"
              onClick={() => fileInput.current?.click()}
            >
              Reprendre une photo
            </button>
          </>
        ) : (
          <>
            <Button variant="primary" full onClick={() => fileInput.current?.click()}>
              Prendre une photo
            </Button>
            <button type="button" className="linkButton linkButton--center" onClick={onManual}>
              Saisir le ticket à la main
            </button>
          </>
        )
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        onChange={(event) => accept(event.target.files?.[0])}
      />

      {preview ? (
        <>
          <CropBox src={preview} crop={crop} onChange={setCrop} />
          <div className="row row--gap row--center">
            <Button onClick={() => setRotation(((rotation + 270) % 360) as Rotation)}>
              ↺ Pivoter
            </Button>
            <Button onClick={() => setRotation(((rotation + 90) % 360) as Rotation)}>
              ↻ Pivoter
            </Button>
            <Button onClick={() => setCrop(FULL_CROP)}>Tout l’écran</Button>
          </div>
        </>
      ) : (
        <div
          className={`dropZone${dragOver ? ' dropZone--over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            accept(event.dataTransfer.files?.[0]);
          }}
        >
          <p>Déposez une photo ici, ou choisissez-en une.</p>
          <Button onClick={() => fileInput.current?.click()}>Choisir une image</Button>
        </div>
      )}

      {error ? <p className="warnText">{error}</p> : null}

      {!online ? (
        <p className="warnText">
          Hors ligne : la photo ne peut pas être envoyée. La saisie à la main reste possible
          dès que le réseau revient.
        </p>
      ) : null}

      {restored ? (
        <p className="muted">
          Photo déjà enregistrée pour ce ticket. Recadrez-la et relisez-la, ou reprenez-en une.
        </p>
      ) : null}

      <ul className="tips">
        <li>Ticket à plat, entier dans le cadre : une ligne coupée est une ligne perdue.</li>
        <li>Évitez les reflets sur le papier brillant.</li>
        <li>Recadrez au plus près : moins d’arrière-plan, lecture plus sûre.</li>
      </ul>
    </Screen>
  );
}
