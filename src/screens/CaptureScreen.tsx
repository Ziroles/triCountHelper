import { useEffect, useRef, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { CropBox } from '../ui/CropBox';
import { Sheet } from '../ui/Sheet';
import { PhotoSourceSheet, useHasCamera } from '../ui/PhotoSourceSheet';
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
  const [confirmReread, setConfirmReread] = useState(false);
  const [pickSource, setPickSource] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const hasCamera = useHasCamera();
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

  /* No camera detected (a computer, mostly): straight to the file picker. */
  const pickPhoto = () => {
    if (hasCamera === false) galleryInput.current?.click();
    else setPickSource(true);
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
            <Button
              variant="primary"
              full
              disabled={busy || !online}
              onClick={() =>
                // A new reading replaces the lines, and the dishes handed out with them.
                receipt.lines.length > 0 ? setConfirmReread(true) : void confirm()
              }
            >
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
              onClick={pickPhoto}
            >
              Reprendre une photo
            </button>
          </>
        ) : (
          <>
            <Button variant="primary" full onClick={pickPhoto}>
              Prendre ou choisir une photo
            </Button>
            <button type="button" className="linkButton linkButton--center" onClick={onManual}>
              Saisir le ticket à la main
            </button>
          </>
        )
      }
    >
      {/* Two hidden inputs: `capture` opens the back camera directly, the
          other one the gallery. The value is cleared so the same file can be
          picked twice in a row. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        data-testid="camera-input"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        data-testid="gallery-input"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {preview ? (
        <>
          <CropBox src={preview} crop={crop} onChange={setCrop} />
          <div className="row row--gap row--center">
            <Button
              aria-label="Pivoter à gauche"
              onClick={() => setRotation(((rotation + 270) % 360) as Rotation)}
            >
              ↺ Pivoter
            </Button>
            <Button
              aria-label="Pivoter à droite"
              onClick={() => setRotation(((rotation + 90) % 360) as Rotation)}
            >
              ↻ Pivoter
            </Button>
            <Button onClick={() => setCrop(FULL_CROP)}>Tout le ticket</Button>
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
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          <p>Photographiez le ticket, ou déposez une image ici.</p>
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
      <PhotoSourceSheet
        open={pickSource}
        onClose={() => setPickSource(false)}
        onCamera={() => cameraInput.current?.click()}
        onGallery={() => galleryInput.current?.click()}
      />
      <Sheet
        open={confirmReread}
        title="Relire le ticket"
        onClose={() => setConfirmReread(false)}
        footer={
          <div className="row row--gap">
            <Button full onClick={() => setConfirmReread(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              full
              onClick={() => {
                setConfirmReread(false);
                void confirm();
              }}
            >
              Relire quand même
            </Button>
          </div>
        }
      >
        <p className="muted">
          Ce ticket a déjà {receipt.lines.length} ligne{receipt.lines.length > 1 ? 's' : ''}. Une
          nouvelle lecture les remplace, avec les plats déjà attribués et vos corrections.
        </p>
      </Sheet>
    </Screen>
  );
}
