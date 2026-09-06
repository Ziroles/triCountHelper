import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import * as api from '../api';
import { ApiError } from '../api';
import { useAppStore } from '../store/useAppStore';
import type { Receipt } from '../types';

type ProcessingScreenProps = {
  receipt: Receipt;
  onBack: () => void;
  onDone: () => void;
};

type Phase =
  | { kind: 'working' }
  | { kind: 'error'; message: string; retryable: boolean; missingKey: boolean };

/**
 * Lecture du ticket par le modèle de vision, exécutée par l'API.
 *
 * Le serveur **écrit le résultat sur le ticket** avant de répondre. Concrètement :
 * si l'écran est fermé ou si la connexion tombe pendant les quelques secondes du
 * modèle, la lecture n'est pas perdue — rouvrir le ticket la montre. C'est ce
 * que l'ancienne version, qui appelait Gemini depuis le navigateur, ne pouvait
 * pas offrir.
 */
export function ProcessingScreen({ receipt, onBack, onDone }: ProcessingScreenProps) {
  const updateReceipt = useAppStore((s) => s.updateReceipt);
  const navigate = useAppStore((s) => s.navigate);
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });
  const started = useRef(false);

  const toManualEntry = useCallback(() => {
    updateReceipt({ step: 'verify' });
    onDone();
  }, [updateReceipt, onDone]);

  const run = useCallback(async () => {
    setPhase({ kind: 'working' });
    try {
      const scanned = await api.scanReceipt(receipt.id);
      updateReceipt(scanned);
      onDone();
    } catch (error) {
      const missingKey = error instanceof ApiError && error.code === 'no_gemini_key';
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : "La lecture n'a pas abouti.",
        retryable: error instanceof ApiError ? error.retryable : true,
        missingKey,
      });
    }
  }, [receipt.id, updateReceipt, onDone]);

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
