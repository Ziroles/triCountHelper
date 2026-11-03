import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { persistedStep, type FlowStep } from '../types';
import { recall } from '../lib/deviceMemory';
import { reconcile } from '../lib/reconcile';
import { CaptureScreen } from './CaptureScreen';
import { ProcessingScreen } from './ProcessingScreen';
import { VerifyScreen } from './VerifyScreen';
import { AssignScreen } from './AssignScreen';
import { AdjustScreen } from './AdjustScreen';
import { ResultsScreen } from './ResultsScreen';

type ReceiptFlowProps = { groupId: string; receiptId: string; step: FlowStep };

/**
 * A receipt's journey, and the arbitration of editing conflicts.
 *
 * A receipt belongs to the group: two people can open it at the same time. When
 * the server refuses a write started from a stale version, we do not rig up a
 * merge — we say so, and let the user choose. Merging amounts automatically
 * would amount to inventing money.
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

  /* Opened straight from its address (a reload, a shared link), the receipt
     arrives without its group: no participants to split between, nobody to
     send to. The group screen is not the only way in any more. */
  const group = useAppStore((s) => s.group);
  const openGroup = useAppStore((s) => s.openGroup);
  const groupLoaded = group?.id === groupId;
  useEffect(() => {
    if (!groupLoaded) void openGroup(groupId);
  }, [groupId, groupLoaded, openGroup]);

  // The current step is remembered on the receipt: reopening it later, or from
  // another device, picks up where it was left. Adjustments are remembered as
  // the dishes step: the API knows no other.
  useEffect(() => {
    const stored = persistedStep(step);
    if (receipt && receipt.id === receiptId && receipt.step !== stored) {
      updateReceipt({ step: stored });
    }
  }, [receipt, receiptId, step, updateReceipt]);

  /* What this device remembers is brought back in line whenever the receipt
     changes, whatever the screen: a tip picked as a percentage follows its
     base, and a discount on some dishes chosen before the API kept them is
     handed over to the receipt. */
  useEffect(() => {
    if (!receipt || receipt.id !== receiptId) return;
    const next = reconcile(receipt, recall(receipt.id));
    if (next) updateReceipt(next);
  }, [receipt, receiptId, updateReceipt]);

  /* The step before this one in history. « Retour » steps back to it when it
     is the right target, so the button and the system gesture agree, and an
     editor opened from the dishes returns to them. Read from history, not
     from the last step shown: coming back to the editor from the dishes is
     not opening it from them. */
  const previousRoute = useAppStore((s) => s.previousRoute);
  const goBack = useAppStore((s) => s.goBack);
  const previousStep =
    previousRoute?.name === 'receipt' && previousRoute.receiptId === receiptId
      ? previousRoute.step
      : null;
  const origin =
    previousStep === 'assign' || previousStep === 'adjust' ? previousStep : null;

  if (!receipt || receipt.id !== receiptId) {
    return (
      <div className="app__loading">{loading ? 'Chargement du ticket…' : 'Ticket introuvable.'}</div>
    );
  }

  const goTo = (next: FlowStep) =>
    navigate({ name: 'receipt', groupId, receiptId, step: next });
  const goToGroup = () => navigate({ name: 'group', groupId });
  const backTo = (previous: FlowStep) =>
    goBack({ name: 'receipt', groupId, receiptId, step: previous });
  const backToGroup = () => goBack({ name: 'group', groupId });

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
            onBack={backToGroup}
            onDone={() => goTo('processing')}
            onSkip={receipt.lines.length > 0 ? () => goTo('assign') : undefined}
            onManual={() => goTo('verify')}
          />
        </>
      );
    case 'processing':
      return (
        <>
          {chrome}
          <ProcessingScreen
            receipt={receipt}
            onBack={() => backTo('capture')}
            onDone={() => goTo('assign')}
            onManual={() => goTo('verify')}
            onRetake={() => goTo('capture')}
          />
        </>
      );
    case 'verify':
      return (
        <>
          {chrome}
          <VerifyScreen
            receipt={receipt}
            onBack={() => (origin ? backTo(origin) : receipt.imageId ? backTo('capture') : backToGroup())}
            onDone={() => (origin ? backTo(origin) : goTo('assign'))}
          />
        </>
      );
    case 'assign':
      return (
        <>
          {chrome}
          <AssignScreen
            receipt={receipt}
            /* Back from the dishes returns to the verification it came from;
               after a reading, it leaves the receipt rather than reopening the
               photo, whose main action re-reads it. The photo stays reachable
               from the menu. */
            onBack={() =>
              previousStep === 'verify' || !receipt.imageId ? backTo('verify') : backToGroup()
            }
            onEditLines={() => goTo('verify')}
            onRetakePhoto={receipt.imageId ? () => goTo('capture') : undefined}
            onDone={() => goTo('adjust')}
          />
        </>
      );
    case 'adjust':
      return (
        <>
          {chrome}
          <AdjustScreen
            receipt={receipt}
            onBack={() => backTo('assign')}
            onEditLines={() => goTo('verify')}
            onDone={() => goTo('results')}
          />
        </>
      );
    case 'results':
      return (
        <>
          {chrome}
          <ResultsScreen receipt={receipt} onBack={() => backTo('adjust')} onHome={goToGroup} />
        </>
      );
    default:
      return null;
  }
}
