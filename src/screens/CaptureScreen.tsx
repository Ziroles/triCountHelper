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
import { useAppStore } from '../store/useAppStore';
import type { Receipt } from '../types';

type CaptureScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onDone: () => void;
  /** Repartir vers la vérification sans relancer la lecture, quand elle a déjà eu lieu. */
  onSkip?: (() => void) | undefined;
  /** Sauter la photo et saisir le ticket à la main. */
  onManual: () => void;
};

/**
 * Photo du ticket : cadrage, rotation, envoi.
 *
 * Le recadrage et la réduction restent **côté client**, avant l'envoi. C'est le
 * seul moyen de n'envoyer qu'un ticket net et léger sur un réseau mobile : une
 * photo de 8 Mpx franchit rarement bien un tunnel de métro, et la partie utile
 * en fait souvent moins d'un tiers.
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

  /* Le ticket garde sa photo : en revenant sur cet écran, on la remet sous les
     yeux plutôt que de présenter une zone de dépôt vide. */
  const imageId = receipt.imageId;
  useEffect(() => {
    if (!imageId) return undefined;
    let cancelled = false;
    void (async () => {
      const blob = (await cachedImage(receipt.id)) ?? (await api.readImage(receipt.id).catch(() => null));
      // Une photo choisie entre-temps prime sur celle qui dormait en cache.
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
    try {
      const rotated = await rotateImage(original, rotation);
      const { blob } = await normalizeCapture(rotated, { crop });
      // On réduit une dernière fois juste avant l'envoi : c'est ce que le modèle
      // recevra, autant que ce soit ce qui passe sur le réseau.
      const upload = await downscaleForUpload(blob);
      const saved = await api.uploadImage(receipt.id, upload);
      void cacheImage(receipt.id, upload);
      updateReceipt({ ...saved, step: 'processing' });
      onDone();
    } catch (cause) {
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
