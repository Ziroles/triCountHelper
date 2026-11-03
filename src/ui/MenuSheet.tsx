import { useState } from 'react';
import { MoreDots } from './Icons';
import { Sheet } from './Sheet';

export type MenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'danger';
};

/** Le bouton « ⋯ » de l'en-tête, et la feuille d'actions secondaires qu'il ouvre. */
export function MenuButton({ items, label = 'Plus d’actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="backButton" aria-label={label} onClick={() => setOpen(true)}>
        <MoreDots />
      </button>
      <Sheet open={open} title="Actions" onClose={() => setOpen(false)}>
        <ul className="menu">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                className={`menu__item${item.tone === 'danger' ? ' menu__item--danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
