import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => import('../test/fakeApi'));

import { CaptureScreen } from '../screens/CaptureScreen';
import { reset, seedReceipt } from '../test/fakeApi';
import { resetForTests } from '../store/useAppStore';

function setDevices(devices: Array<{ kind: string }> | null) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: devices === null ? undefined : { enumerateDevices: () => Promise.resolve(devices) },
  });
}

function renderCapture() {
  const receipt = seedReceipt('tTEST123456');
  render(
    <CaptureScreen receipt={receipt} onBack={() => {}} onDone={() => {}} onManual={() => {}} />,
  );
  return {
    camera: screen.getByTestId('camera-input') as HTMLInputElement,
    gallery: screen.getByTestId('gallery-input') as HTMLInputElement,
  };
}

describe('choix de la source photo', () => {
  beforeEach(() => {
    reset();
    resetForTests();
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:ticket'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => setDevices(null));

  it('le champ appareil photo vise la caméra arrière, la galerie non', () => {
    const { camera, gallery } = renderCapture();
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(gallery).not.toHaveAttribute('capture');
  });

  it('chaque bouton de la feuille ouvre le bon champ', async () => {
    setDevices([{ kind: 'videoinput' }]);
    const user = userEvent.setup();
    const { camera, gallery } = renderCapture();
    const cameraClick = vi.spyOn(camera, 'click').mockImplementation(() => {});
    const galleryClick = vi.spyOn(gallery, 'click').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: 'Prendre ou choisir une photo' }));
    await user.click(await screen.findByRole('button', { name: 'Prendre une photo' }));
    expect(cameraClick).toHaveBeenCalledOnce();
    expect(galleryClick).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prendre ou choisir une photo' }));
    await user.click(await screen.findByRole('button', { name: 'Choisir dans la galerie' }));
    expect(galleryClick).toHaveBeenCalledOnce();
  });

  it('sans API de détection, la feuille reste proposée', async () => {
    setDevices(null);
    const user = userEvent.setup();
    renderCapture();
    await user.click(screen.getByRole('button', { name: 'Prendre ou choisir une photo' }));
    expect(await screen.findByRole('dialog', { name: 'Photo du ticket' })).toBeInTheDocument();
  });

  it('sans appareil photo, ouvre directement le sélecteur de fichiers', async () => {
    setDevices([{ kind: 'audioinput' }]);
    const user = userEvent.setup();
    const { gallery } = renderCapture();
    const galleryClick = vi.spyOn(gallery, 'click').mockImplementation(() => {});

    // Let the asynchronous detection settle.
    await act(() => Promise.resolve());
    await user.click(screen.getByRole('button', { name: 'Prendre ou choisir une photo' }));
    expect(galleryClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['camera', 'gallery'] as const)('une image du champ %s mène au recadrage', async (which) => {
    const user = userEvent.setup();
    const inputs = renderCapture();
    await user.upload(inputs[which], new File(['photo'], 'ticket.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByAltText(/ticket/i)).toHaveAttribute('src', 'blob:ticket');
    expect(screen.getByRole('button', { name: 'Lire le ticket' })).toBeInTheDocument();
  });
});
