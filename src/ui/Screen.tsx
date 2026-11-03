import type { ReactNode } from 'react';
import { ChevronLeft } from './Icons';
import { StepIndicator, type StepNumber } from './StepIndicator';

type ScreenProps = {
  title: string;
  /** Sous le titre : `groupe, date` sur les écrans d'un ticket. */
  subtitle?: ReactNode;
  onBack?: () => void;
  /** À droite de l'en-tête : un lien, ou le bouton « ⋯ ». */
  action?: ReactNode;
  /** Étape du parcours d'un ticket, affichée sous l'en-tête. */
  step?: StepNumber;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function Screen({ title, subtitle, onBack, action, step, banner, footer, children }: ScreenProps) {
  return (
    <div className="screen">
      <header className="screen__head">
        <div className="screen__headRow">
          {onBack ? (
            <button type="button" className="backButton" onClick={onBack} aria-label="Retour">
              <ChevronLeft />
            </button>
          ) : null}
          <div className="screen__titles">
            <h1 className="screen__title">{title}</h1>
            {subtitle ? <p className="screen__subtitle">{subtitle}</p> : null}
          </div>
          {action ? <div className="screen__action">{action}</div> : null}
        </div>
        {step ? <StepIndicator step={step} /> : null}
      </header>

      <main className="screen__body">{children}</main>

      {banner || footer ? (
        <div className="screen__foot">
          {banner}
          {footer ? <div className="screen__footAction">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
