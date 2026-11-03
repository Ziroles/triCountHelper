import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import * as api from '../api';
import { ApiError } from '../api';
import { readReceipt } from '../lib/gemini';
import { describeReadingError, type ReadingError } from '../lib/errors';
import { logger } from '../lib/log';
import { useAppStore } from '../store/useAppStore';
import { useReceiptImage } from '../hooks/useReceiptImage';
import type { Receipt } from '../types';

const log = logger('scan');

/**
 * Reading done here, with the user's own key.
 *
 * The photo comes back down from the API — it is already there, and the
 * alternative would be keeping a second copy in the browser just in case.
 */
async function readHere(receiptId: string, apiKey: string, model: string): Promise<Receipt> {
  const blob = await api.readImage(receiptId);
  if (blob === null) {
    throw new ApiError('La photo de ce ticket n’est plus disponible.', 404, 'image_missing', false);
  }
  const base64 = await toBase64(blob);
  const raw = await readReceipt(apiKey, model, base64, blob.type || 'image/jpeg');
  return api.submitExtraction(receiptId, raw);
}

/** Blob → base64 without the `data:` prefix, which is what Gemini expects. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('photo illisible'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

type ProcessingScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onDone: () => void;
  /** The reading failed or was given up on: enter the lines by hand. */
  onManual: () => void;
  /** Back to the photo, to take or frame it again. */
  onRetake: () => void;
};

type Phase =
  | { kind: 'working' }
  | { kind: 'error'; error: ReadingError };

/**
 * Reading of the receipt by the vision model.
 *
 * Two paths, and which one runs depends on whose key pays for it:
 *
 *   own key  → this browser calls Google, and posts the raw answer to the API.
 *              The key never touches the SplitTicket server.
 *   no key   → the API calls Google with the instance's own key.
 *
 * Either way the **API writes the result onto the receipt** before answering:
 * if the screen is closed or the connection drops during the model's few
 * seconds, the reading is not lost — reopening the receipt shows it.
 */
export function ProcessingScreen({
  receipt,
  onBack,
  onDone,
  onManual,
  onRetake,
}: ProcessingScreenProps) {
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const navigate = useAppStore((s) => s.navigate);
  const geminiKey = useAppStore((s) => s.geminiKey);
  const model = useAppStore((s) => s.server.geminiModel);
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });
  const started = useRef(false);
  const [wait, setWait] = useState(0);

  const imageUrl = useReceiptImage(receipt.id, receipt.imageId);

  const run = useCallback(async () => {
    setPhase({ kind: 'working' });
    /* The vision model takes a few seconds and costs a call. Its duration is
       the only measure that says whether an "it's slow" comes from it or from
       something else; and the number of lines read says straight away whether
       the result is worth anything, without opening the next screen. */
    const done = log.time(`reading receipt ${receipt.id}`);
    log.info('reading requested', { receipt: receipt.id, ownKey: geminiKey !== null });
    try {
      const scanned = geminiKey === null
        ? await api.scanReceipt(receipt.id)
        : await readHere(receipt.id, geminiKey, model);
      done(
        `${scanned.lines.length} lines, ${scanned.taxes.length} taxes, ` +
          `stated total ${scanned.statedTotalCents ?? '—'}`,
      );
      updateReceipt(scanned);
      // Nothing read: there are no dishes to hand out, the lines must be typed.
      if (scanned.lines.length === 0) onManual();
      else onDone();
    } catch (error) {
      const described = describeReadingError(error, geminiKey === null ? null : model);
      log.error(`reading failed: ${described.code}`, error);
      setWait(described.retryAfterSeconds ?? 0);
      setPhase({ kind: 'error', error: described });
    }
  }, [receipt.id, geminiKey, model, updateReceipt, onDone, onManual]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  // Google said how long to wait: count down before allowing a retry.
  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = window.setTimeout(() => setWait((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const failure = phase.kind === 'error' ? phase.error : null;
  const failed = failure !== null;

  const act = (action: ReadingError['action']) => {
    if (action === 'retry') void run();
    else if (action === 'settings') navigate({ name: 'settings' });
    else if (action === 'retake') onRetake();
    else onManual();
  };

  return (
    <Screen
      title="Lecture du ticket"
      onBack={onBack}
      footer={
        failure ? (
          <>
            <Button
              variant="primary"
              full
              disabled={failure.action === 'retry' && wait > 0}
              onClick={() => act(failure.action)}
            >
              {failure.action === 'retry' && wait > 0
                ? `Réessayer dans ${wait} s`
                : failure.actionLabel}
            </Button>
            {failure.action !== 'retry' && failure.action !== 'manual' && failure.code !== 'no_key' ? (
              <Button full onClick={() => void run()}>
                Réessayer
              </Button>
            ) : null}
            {failure.action !== 'manual' ? (
              <button type="button" className="linkButton linkButton--center" onClick={onManual}>
                Saisir à la main
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      <div className="reading">
        {imageUrl ? <img className="reading__thumb" src={imageUrl} alt="Photo du ticket" /> : null}
        {failed ? (
          <div className="reading__text" role="alert">
            <p className="reading__title">{failure.title}</p>
            <p className="muted">{failure.detail}</p>
          </div>
        ) : (
          <div className="reading__text">
            <p className="reading__title">Lecture du ticket…</p>
            <div className="progress" role="progressbar" aria-label="Lecture du ticket">
              <div className="progress__bar progress__bar--pulse" />
            </div>
            <p className="muted">
              Quelques secondes. Le résultat est conservé même si vous quittez cet écran.
            </p>
          </div>
        )}
      </div>
    </Screen>
  );
}
