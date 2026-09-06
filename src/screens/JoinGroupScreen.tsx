import { useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { useAppStore } from '../store/useAppStore';

/**
 * Rejoindre un groupe en collant un lien de partage Tricount.
 *
 * Le lien complet et le code nu marchent tous les deux : l'utilisateur colle ce
 * qu'il a sous la main, et refuser un code au motif qu'il lui manque un nom de
 * domaine serait une chicane, pas une validation.
 */
export function JoinGroupScreen() {
  const navigate = useAppStore((s) => s.navigate);
  const joinGroup = useAppStore((s) => s.joinGroup);
  const [shareUrl, setShareUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (shareUrl.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const group = await joinGroup(shareUrl);
      navigate({ name: 'group', groupId: group.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le groupe n’a pas pu être rejoint.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Rejoindre un groupe"
      onBack={() => navigate({ name: 'groups' })}
      footer={
        <Button
          variant="primary"
          full
          disabled={busy || shareUrl.trim() === ''}
          onClick={() => void submit()}
        >
          {busy ? 'Connexion au tricount…' : 'Rejoindre'}
        </Button>
      }
    >
      <label className="field">
        <span className="field__label">Lien de partage Tricount</span>
        <input
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          placeholder="https://tricount.com/tABC123456"
          value={shareUrl}
          onChange={(event) => setShareUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
      </label>

      {error ? <p className="warnText">{error}</p> : null}

      <ul className="tips">
        <li>
          Dans Tricount : ouvrez le tricount, « Inviter des participants », puis copiez le lien.
        </li>
        <li>Le code seul fonctionne aussi, si c’est tout ce que vous avez.</li>
        <li>
          Les participants du tricount deviennent ceux du groupe : rien à ressaisir, et les
          montants leur sont attribués sans risque d’homonyme.
        </li>
      </ul>

      <p className="muted">
        Tricount ne publie pas d’interface officielle. Cette connexion passe par un client non
        officiel : elle peut cesser de fonctionner sans préavis. La copie du récapitulatif en
        texte, elle, marchera toujours.
      </p>
    </Screen>
  );
}
