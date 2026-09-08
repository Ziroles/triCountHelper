import { useEffect, useState } from 'react';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { useAppStore } from '../store/useAppStore';
import { clearCache, estimateStorage, forgetEverything } from '../db';
import * as api from '../api';
import { TAX_REGIMES, type TipBasis } from '../types';
import { hint } from '../lib/crypto';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Settings.
 *
 * Two kinds of settings live side by side, and the distinction is visible on
 * screen: what belongs to this device (theme, defaults) and what the server
 * holds for you (Gemini key, account). The key is never shown again — only a
 * few characters, enough to recognise which one is in place.
 */
export function SettingsScreen() {
  const navigate = useAppStore((s) => s.navigate);
  const settings = useAppStore((s) => s.settings);
  const server = useAppStore((s) => s.server);
  const geminiKey = useAppStore((s) => s.geminiKey);
  const accountEmail = useAppStore((s) => s.accountEmail);
  const online = useAppStore((s) => s.online);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const updateServerSettings = useAppStore((s) => s.updateServerSettings);
  const refreshMe = useAppStore((s) => s.refreshMe);

  const [keyDraft, setKeyDraft] = useState('');
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [models, setModels] = useState<{ name: string; displayName: string }[] | null>(null);
  const [modelsStatus, setModelsStatus] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  // Optional account.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountStatus, setAccountStatus] = useState<string | null>(null);

  const refreshStorage = () => {
    void estimateStorage().then(setStorage);
  };
  useEffect(refreshStorage, []);

  const saveKey = async (value: string) => {
    setKeyStatus('Chiffrement…');
    try {
      await updateServerSettings({ geminiKey: value });
      setKeyDraft('');
      setKeyStatus(value === '' ? 'Clé effacée.' : 'Clé chiffrée et enregistrée.');
    } catch (error) {
      if (error instanceof Error && error.message === 'account_required') {
        setKeyStatus('Créez un compte ci-dessous pour enregistrer votre clé.');
        return;
      }
      setKeyStatus(error instanceof Error ? error.message : 'Échec.');
    }
  };

  const hasOwnKey = geminiKey !== null;
  /* A blob we hold but cannot open: the password changed on another device.
     Nothing is recoverable, and saying so is more useful than an empty field. */
  const keyLocked = geminiKey === null && server.geminiKeyBlob !== null;
  const noKeyAnywhere = !hasOwnKey && !server.serverHasGeminiKey;

  return (
    <Screen title="Réglages" onBack={() => navigate({ name: 'groups' })}>
      <section className="section">
        <h2>Lecture des tickets</h2>
        <p className="muted">
          Les tickets sont lus par un modèle Gemini. Avec votre propre clé, l’appel part{' '}
          <strong>directement de cet appareil</strong> vers Google :{' '}
          <strong>votre clé ne passe jamais par le serveur SplitTicket</strong>.{' '}
          <strong>La photo est envoyée à Google</strong> pour cette seule opération.
        </p>

        {noKeyAnywhere ? (
          <p className="warnText">
            Aucune clé Gemini n’est disponible : ce serveur n’en fournit pas. Renseignez la
            vôtre ci-dessous pour lire des tickets en photo. Sans clé, la saisie à la main
            fonctionne normalement.
          </p>
        ) : keyLocked ? (
          <p className="warnText">
            Une clé est enregistrée, mais cet appareil ne peut plus l’ouvrir — le mot de passe
            du compte a changé depuis. Elle est définitivement illisible, y compris pour le
            serveur : ressaisissez-la ci-dessous.
          </p>
        ) : hasOwnKey ? (
          <p className="muted">
            Votre clé <span className="num">{hint(geminiKey)}</span> est enregistrée, et elle
            est utilisée en priorité.
          </p>
        ) : (
          <p className="muted">
            Ce serveur fournit une clé. Vous pouvez enregistrer la vôtre pour que vos lectures
            soient débitées sur votre quota.
          </p>
        )}

        <label className="field">
          <span className="field__label">
            Votre clé API
            <span className="muted">
              {' '}
              — chiffrée sur cet appareil avant d’être envoyée. Le serveur la conserve sans
              pouvoir la lire : un mot de passe oublié la perd définitivement.
            </span>
          </span>
          <div className="row row--gap">
            <input
              type="password"
              className="grow"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasOwnKey ? '••••••••' : 'AIza…'}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <Button
              disabled={!online || keyDraft.trim() === ''}
              onClick={() => void saveKey(keyDraft.trim())}
            >
              Enregistrer
            </Button>
          </div>
        </label>
        {hasOwnKey || keyLocked ? (
          <Button variant="quiet" disabled={!online} onClick={() => void saveKey('')}>
            Effacer ma clé
          </Button>
        ) : null}
        {keyStatus ? <p className="muted">{keyStatus}</p> : null}

        <label className="field">
          <span className="field__label">
            Modèle
            <span className="muted"> — ces noms changent, demandez la liste à jour</span>
          </span>
          {models === null ? (
            /* Free-form entry until we have the list: we only publish on field
               blur, so as not to write to the server on every keystroke. */
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              defaultValue={server.geminiModel}
              key={server.geminiModel}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== server.geminiModel) void updateServerSettings({ geminiModel: value });
              }}
            />
          ) : (
            <select
              value={models.some((m) => m.name === server.geminiModel) ? server.geminiModel : ''}
              onChange={(event) => void updateServerSettings({ geminiModel: event.target.value })}
            >
              <option value="" disabled>
                Choisir un modèle…
              </option>
              {models.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <Button
          disabled={!online || noKeyAnywhere || modelsStatus === 'Vérification…'}
          onClick={() => {
            setModelsStatus('Vérification…');
            void api
              .listModels()
              .then((found) => {
                setModels(found);
                setModelsStatus(
                  found.some((m) => m.name === server.geminiModel)
                    ? `Clé valide, ${found.length} modèles. Le modèle choisi existe.`
                    : `Clé valide, ${found.length} modèles. « ${server.geminiModel} » n’en fait pas partie : choisissez-en un.`,
                );
              })
              .catch((error: unknown) => {
                setModels(null);
                setModelsStatus(
                  error instanceof Error ? error.message : 'Échec de la vérification.',
                );
              });
          }}
        >
          Vérifier la clé et lister les modèles
        </Button>
        {modelsStatus !== null ? (
          <p className={models === null && modelsStatus !== 'Vérification…' ? 'warnText' : 'muted'}>
            {modelsStatus}
          </p>
        ) : null}
      </section>

      <section className="section">
        <h2>Taxes et pourboire</h2>
        <label className="field">
          <span className="field__label">
            Régime fiscal
            <span className="muted"> — proposé quand le ticket n’imprime pas ses taxes</span>
          </span>
          <select
            value={settings.taxRegimeCode}
            onChange={(event) => void updateSettings({ taxRegimeCode: event.target.value })}
          >
            {TAX_REGIMES.map((regime) => (
              <option key={regime.code} value={regime.code}>
                {regime.label} — {regime.taxes.map((tax) => tax.label).join(' + ')}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Les prix des lignes sont hors taxes : les taxes lues en pied de ticket s’ajoutent au
          sous-total, et chacune se répartit sur les seules lignes qui y sont soumises.
        </p>
        <div className="row row--gap">
          <label className="field field--grow">
            <span className="field__label">Pourboire proposé</span>
            <select
              value={settings.defaultTipPercent}
              onChange={(event) =>
                void updateSettings({ defaultTipPercent: Number(event.target.value) })
              }
            >
              {[0, 10, 15, 18, 20, 25].map((percent) => (
                <option key={percent} value={percent}>
                  {percent === 0 ? 'aucun' : `${percent} %`}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--grow">
            <span className="field__label">Calculé sur</span>
            <select
              value={settings.defaultTipBasis}
              onChange={(event) =>
                void updateSettings({ defaultTipBasis: event.target.value as TipBasis })
              }
            >
              <option value="subtotal">avant taxes</option>
              <option value="total">taxes comprises</option>
            </select>
          </label>
        </div>
      </section>

      <section className="section">
        <h2>Apparence</h2>
        <label className="field">
          <span className="field__label">Thème</span>
          <select
            value={settings.theme}
            onChange={(event) =>
              void updateSettings({ theme: event.target.value as typeof settings.theme })
            }
          >
            <option value="system">Système</option>
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
          </select>
        </label>
      </section>

      <section className="section">
        <h2>Synchronisation</h2>
        {accountEmail ? (
          <p className="muted">
            Cet appareil est rattaché à <strong>{accountEmail}</strong>. Vos groupes suivent ce
            compte : connectez-vous avec la même adresse sur un autre appareil pour les y
            retrouver.
          </p>
        ) : (
          <>
            <p className="muted">
              Cet appareil fonctionne sans compte, et c’est suffisant. Un compte ne sert qu’à
              une chose : retrouver vos groupes depuis un autre appareil — ou après avoir
              changé de téléphone.
            </p>
            <label className="field">
              <span className="field__label">Adresse courriel</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Mot de passe</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="row row--gap">
              <Button
                full
                disabled={!online || email.trim() === '' || password.length < 8}
                onClick={() => {
                  setAccountStatus('…');
                  void api
                    .createAccount(email.trim(), password)
                    .then(() => {
                      setPassword('');
                      setAccountStatus(null);
                      return refreshMe();
                    })
                    .catch((error: unknown) =>
                      setAccountStatus(error instanceof Error ? error.message : 'Échec.'),
                    );
                }}
              >
                Créer un compte
              </Button>
              <Button
                full
                disabled={!online || email.trim() === '' || password === ''}
                onClick={() => {
                  setAccountStatus('…');
                  void api
                    .openSession(email.trim(), password)
                    .then(() => {
                      setPassword('');
                      setAccountStatus(null);
                      return refreshMe();
                    })
                    .catch((error: unknown) =>
                      setAccountStatus(error instanceof Error ? error.message : 'Échec.'),
                    );
                }}
              >
                Se connecter
              </Button>
            </div>
            <p className="muted">Le mot de passe doit faire au moins 8 caractères.</p>
            {accountStatus ? <p className="warnText">{accountStatus}</p> : null}
          </>
        )}
      </section>

      <section className="section">
        <h2>Données</h2>
        <p className="muted">
          Les tickets, les photos et les groupes sont conservés par le serveur, pour que tous
          les participants d’un groupe voient les mêmes montants. Cet appareil n’en garde
          qu’une copie de lecture, pour rester consultable hors ligne.
        </p>
        <p className="muted">
          {storage
            ? `Cache local : ${formatBytes(storage.usage)}${
                storage.quota ? ` sur ${formatBytes(storage.quota)}` : ''
              }`
            : 'Cache local : taille inconnue'}
        </p>
        <Button
          variant="quiet"
          onClick={() => {
            void clearCache().finally(refreshStorage);
          }}
        >
          Vider le cache local
        </Button>
        <Button variant="danger" onClick={() => setConfirmWipe(true)}>
          Dissocier cet appareil
        </Button>
      </section>

      <Sheet
        open={confirmWipe}
        title="Dissocier cet appareil"
        onClose={() => setConfirmWipe(false)}
        footer={
          <div className="row row--gap">
            <Button full onClick={() => setConfirmWipe(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => {
                void forgetEverything().then(() => window.location.reload());
              }}
            >
              Dissocier
            </Button>
          </div>
        }
      >
        <p className="muted">
          Cet appareil oubliera son identité et son cache, puis s’enrôlera à nouveau comme un
          appareil neuf.
        </p>
        <p className="muted">
          {accountEmail
            ? 'Vos groupes restent attachés à votre compte : reconnectez-vous pour les retrouver.'
            : 'Sans compte, vos groupes ne seront plus accessibles depuis cet appareil — il faudra recoller leurs liens de partage. Les tickets, eux, restent côté serveur pour les autres participants.'}
        </p>
      </Sheet>
    </Screen>
  );
}
