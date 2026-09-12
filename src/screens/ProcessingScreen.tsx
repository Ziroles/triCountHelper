import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import * as api from '../api';
import { ApiError } from '../api';
import { GeminiError, readReceipt } from '../lib/gemini';
import { logger } from '../lib/log';
import { useAppStore } from '../store/useAppStore';
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
};

type Phase =
  | { kind: 'working' }
  | { kind: 'error'; message: string; retryable: boolean; missingKey: boolean };

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
export function ProcessingScreen({ receipt, onBack, onDone }: ProcessingScreenProps) {
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const navigate = useAppStore((s) => s.navigate);
  const geminiKey = useAppStore((s) => s.geminiKey);
  const model = useAppStore((s) => s.server.geminiModel);
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });
  const started = useRef(false);

  const toManualEntry = useCallback(() => {
    updateReceipt({ step: 'verify' });
    onDone();
  }, [updateReceipt, onDone]);

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
      onDone();
    } catch (error) {
      const missingKey = error instanceof ApiError && error.code === 'no_gemini_key';
      log.error(missingKey ? 'reading impossible: no Gemini key' : 'reading failed', error);
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : "La lecture n'a pas abouti.",
        retryable:
          error instanceof ApiError || error instanceof GeminiError ? error.retryable : true,
        missingKey,
      });
    }
  }, [receipt.id, geminiKey, model, updateReceipt, onDone]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <Screen title="Lecture" onBack={onBack}>
      {phase.kind === 'error' ? (
        <div className="stack">
          <p className="warnText">{phase.message}</p>
          <p className="muted">
            La saisie manuelle reste disponible : les lignes se corrigent aussi vite qu’elles se
            tapent.
          </p>
          <div className="row row--gap">
            {phase.retryable ? (
              <Button full onClick={() => void run()}>
                Réessayer
              </Button>
            ) : null}
            {phase.missingKey ? (
              <Button full onClick={() => navigate({ name: 'settings' })}>
                Ouvrir les réglages
              </Button>
            ) : null}
            <Button variant="primary" full onClick={toManualEntry}>
              Saisir à la main
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack stack--center">
          <p className="progress__label">Lecture du ticket</p>
          <div className="progress" role="progressbar" aria-label="Lecture du ticket">
            <div className="progress__bar progress__bar--pulse" />
          </div>
          <p className="muted">
            Le serveur lit la photo. Comptez quelques secondes — le résultat est conservé même
            si vous quittez cet écran.
          </p>
        </div>
      )}
    </Screen>
  );
}
