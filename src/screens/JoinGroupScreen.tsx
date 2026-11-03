import { useState } from 'react';
import { extractShareLink } from '../lib/shareLink';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { useAppStore } from '../store/useAppStore';

/**
 * Join a group by pasting a Tricount share link.
 *
 * The full invitation message, the link and the bare code all work: the user
 * pastes whatever they have to hand. The link found is shown before sending,
 * and only that link goes to the API.
 */
export function JoinGroupScreen() {
  const navigate = useAppStore((s) => s.navigate);
  const goBack = useAppStore((s) => s.goBack);
  const joinGroup = useAppStore((s) => s.joinGroup);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = extractShareLink(text);
  const typed = text.trim() !== '';

  const submit = async () => {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const group = await joinGroup(link.url);
      navigate({ name: 'group', groupId: group.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le groupe n’a pas pu être rejoint.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Lier un groupe Tricount"
      onBack={() => goBack({ name: 'groups' })}
      footer={
        <Button
          variant="primary"
          full
          disabled={busy || !link}
          onClick={() => void submit()}
        >
          {busy ? 'Connexion au tricount…' : 'Lier ce groupe'}
        </Button>
      }
    >
      <label className="field">
        <span className="field__label">Lien ou message d’invitation Tricount</span>
        <textarea
          autoFocus
          rows={4}
          autoComplete="off"
          spellCheck={false}
          placeholder="Collez le lien ou le message d’invitation"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
      </label>

      {link ? (
        <p className="okText" aria-live="polite">
          Lien trouvé : <span className="num">tricount.com/{link.code}</span>
          {link.several ? ' (plusieurs liens dans le texte, le premier est utilisé)' : null}
        </p>
      ) : typed ? (
        <p className="warnText" aria-live="polite">
          Aucun lien Tricount dans ce texte.
        </p>
      ) : null}

      {error ? <p className="warnText">{error}</p> : null}

      <ul className="tips">
        <li>
          Dans Tricount : ouvrez le tricount, « Inviter des participants », puis copiez le lien
          ou le message entier.
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
