import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import type { ReceiptStep } from '../types';
import { CaptureScreen } from './CaptureScreen';
import { ProcessingScreen } from './ProcessingScreen';
import { VerifyScreen } from './VerifyScreen';
import { AssignScreen } from './AssignScreen';
import { ResultsScreen } from './ResultsScreen';

type ReceiptFlowProps = { groupId: string; receiptId: string; step: ReceiptStep };

/**
 * Le parcours d'un ticket, et l'arbitrage des conflits d'édition.
 *
 * Un ticket appartient au groupe : deux personnes peuvent l'ouvrir en même
 * temps. Quand le serveur refuse une écriture partie d'une version périmée, on
 * ne bricole pas une fusion — on le dit, et on laisse choisir. Fusionner des
 * montants automatiquement reviendrait à inventer de l'argent.
 */
function ConflictSheet() {
  const conflict = useAppStore((s) => s.conflict);
  const keepServerVersion = useAppStore((s) => s.keepServerVersion);

  return (
    <Sheet
      open={conflict !== null}
      title="Modifié ailleurs"
      onClose={keepServerVersion}
      footer={
        <Button variant="primary" full onClick={keepServerVersion}>
          Reprendre la version du groupe
        </Button>
      }
    >
      <p className="muted">
        Quelqu’un d’autre a modifié ce ticket pendant que vous y travailliez. Vos dernières
        corrections n’ont pas été enregistrées.
      </p>
      <p className="muted">
        Reprendre la version du groupe recharge le ticket tel qu’il est côté serveur. Notez ce
        que vous vouliez changer avant de continuer : il faudra le ressaisir.
      </p>
    </Sheet>
  );
}

function SaveStrip() {
  const saveState = useAppStore((s) => s.saveState);
  const saveError = useAppStore((s) => s.saveError);
  const dismiss = useAppStore((s) => s.dismissSaveError);
  const saveNow = useAppStore((s) => s.saveNow);

  if (saveState === 'idle' || saveState === 'saving' || saveState === 'conflict') return null;

  return (
    <Banner
      tone="warn"
      label={saveState === 'offline' ? 'Hors ligne' : 'Enregistrement'}
      action={
        <>
          <button type="button" className="linkButton" onClick={() => void saveNow()}>
            Réessayer
          </button>
          <button type="button" className="linkButton" onClick={dismiss}>
            Masquer
          </button>
        </>
      }
    >
      {saveError ?? 'Les modifications n’ont pas été enregistrées.'}
    </Banner>
  );
}

export function ReceiptFlow({ groupId, receiptId, step }: ReceiptFlowProps) {
  const receipt = useAppStore((s) => s.receipt);
  const loading = useAppStore((s) => s.loadingReceipt);
  const navigate = useAppStore((s) => s.navigate);
  const openReceipt = useAppStore((s) => s.openReceipt);
  const updateReceipt = useAppStore((s) => s.updateReceipt);

  useEffect(() => {
    void openReceipt(receiptId);
  }, [receiptId, openReceipt]);

  // L'étape courante est mémorisée sur le ticket : le rouvrir plus tard, ou
  // depuis un autre appareil, reprend là où on l'avait laissé.
  useEffect(() => {
    if (receipt && receipt.id === receiptId && receipt.step !== step) {
      updateReceipt({ step });
    }
  }, [receipt, receiptId, step, updateReceipt]);

  if (!receipt || receipt.id !== receiptId) {
    return (
      <div className="app__loading">{loading ? 'Chargement du ticket…' : 'Ticket introuvable.'}</div>
    );
  }

  const goTo = (next: ReceiptStep) =>
    navigate({ name: 'receipt', groupId, receiptId, step: next });
  const goToGroup = () => navigate({ name: 'group', groupId });

  const chrome = (
    <>
      <SaveStrip />
      <ConflictSheet />
    </>
  );

  switch (step) {
    case 'capture':
      return (
        <>
          {chrome}
          <CaptureScreen
            receipt={receipt}
            onBack={goToGroup}
            onDone={() => goTo('processing')}
            onSkip={receipt.lines.length > 0 ? () => goTo('verify') : undefined}
            onManual={() => goTo('verify')}
          />
        </>
      );
    case 'processing':
      return (
        <>
          {chrome}
          <ProcessingScreen receipt={receipt} onBack={() => goTo('capture')} onDone={() => goTo('verify')} />
        </>
      );
    case 'verify':
      return (
        <>
          {chrome}
          <VerifyScreen
            receipt={receipt}
            onBack={() => (receipt.imageId ? goTo('capture') : goToGroup())}
            onDone={() => goTo('assign')}
          />
        </>
      );
    case 'assign':
      return (
        <>
          {chrome}
          <AssignScreen receipt={receipt} onBack={() => goTo('verify')} onDone={() => goTo('results')} />
        </>
      );
    case 'results':
      return (
        <>
          {chrome}
          <ResultsScreen receipt={receipt} onBack={() => goTo('assign')} onHome={goToGroup} />
        </>
      );
    default:
      return null;
  }
}
