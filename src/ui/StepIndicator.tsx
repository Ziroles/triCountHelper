export type StepNumber = 1 | 2 | 3;

const LABELS: Record<StepNumber, string> = {
  1: 'Plats',
  2: 'Ajustements',
  3: 'Envoi',
};

const FILL: Record<StepNumber, string> = { 1: '33%', 2: '66%', 3: '100%' };

/** « Plats … Étape 1 sur 3 », et la piste de progression dessous. */
export function StepIndicator({ step }: { step: StepNumber }) {
  return (
    <div className="steps">
      <div className="steps__text">
        <span className="steps__name">{LABELS[step]}</span>
        <span>Étape {step} sur 3</span>
      </div>
      <div
        className="steps__track"
        role="progressbar"
        aria-label="Progression"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        aria-valuetext={`Étape ${step} sur 3 : ${LABELS[step]}`}
      >
        <span className="steps__fill" style={{ width: FILL[step] }} />
      </div>
    </div>
  );
}
