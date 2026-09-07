# SplitTicket

Une application web progressive (PWA) pour photographier un ticket de caisse, en extraire les
lignes par IA de vision, attribuer chaque article à une ou plusieurs personnes, et calculer
exactement ce que chacun doit.

Les participants ne se saisissent pas : un **groupe** est un tricount, rejoint en collant son
lien de partage, et ses membres deviennent les participants. Les tickets appartiennent au
groupe — tous ses membres voient les mêmes montants, depuis n'importe quel appareil.

> [!IMPORTANT]
> **Où vivent vos données.** Les tickets, leurs photos et les groupes sont conservés par
> l'[API SplitTicket](https://github.com/Ziroles/tricountApi), que vous hébergez. Ce n'est plus
> une application locale : c'est ce qui permet à plusieurs personnes de partager un ticket, et
> de retrouver le sien après avoir changé de téléphone.
>
> Chaque appareil garde une **copie de lecture** : hors ligne, l'application reste consultable,
> mais toute modification attend le réseau.
>
> Deux tiers reçoivent des données, et seulement eux : **Google Gemini**, la photo d'un ticket
> au moment de le lire, et **Tricount**, le récapitulatif si vous demandez l'envoi.

---

## Prérequis

- **Node.js** 20+ (LTS recommandé) et `npm`
- **L'API SplitTicket** en marche — voir [`tricountApi`](https://github.com/Ziroles/tricountApi).
  Sans elle, l'application n'a rien à afficher.
- **Une clé Google Gemini**, si votre instance n'en fournit pas. Elle se crée en quelques
  secondes sur [Google AI Studio](https://aistudio.google.com/) et se colle dans les Réglages.
  Sans clé, tout le reste fonctionne : saisie manuelle, taxes canadiennes, pourboire, export.

---

## Démarrer

1. **Cloner et installer** :
   ```bash
   git clone https://github.com/MathieuMarthy/triCountHelper.git
   cd triCountHelper
   npm install
   ```

2. **Lancer l'API** (dans l'autre dépôt), sur le port 8787.

3. **Lancer l'application** :
   ```bash
   npm run dev
   ```
   `/api` est déjà mandaté vers `http://localhost:8787` : il n'y a rien à configurer.
   Ouvrez l'URL affichée, généralement `http://localhost:5173`.

4. **Rejoindre un groupe** : collez le lien de partage d'un tricount. Ses participants
   apparaissent aussitôt.

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement, rechargement à chaud, `/api` mandaté, logs du navigateur dans ce terminal |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Sert `dist/` avec le service worker actif |
| `npm test` | Suite de tests (Vitest) |
| `npm run typecheck` | Vérification TypeScript |

L'intégration continue (`.github/workflows/ci.yml`) lance typage, tests et build à chaque
poussée et chaque demande de tirage.

Le `dist/` produit fait environ 255 Kio : des fichiers statiques. N'importe quel hébergeur
convient (ou le conteneur Docker Nginx fourni).

---

## Journal

**Les logs de l'application s'affichent dans le terminal, pas dans le navigateur.**

En développement, chaque ligne remonte par le canal du HMR et s'écrit dans la console qui
fait tourner `npm run dev`. C'est délibéré : l'application se teste au téléphone, ticket de
caisse en main, et sur un téléphone il n'y a pas de console à ouvrir. Un seul journal, celui
qu'on est déjà en train de lire.

```
22:20:34.329 info  boot         démarrage
                                { mode: 'development', enLigne: true }
22:20:34.329 debug api          GET /v1/groups → 200 en 34 ms
22:20:34.329 warn  store        conflit de version : le ticket a bougé ailleurs
                                { ticket: 'r-42', versionLocale: 7 }
  → api  POST /v1/receipts/r-42/scan
  ← api  POST /v1/receipts/r-42/scan → 200
```

Les lignes `→ api` / `← api` viennent du proxy Vite, pas de la page : c'est le seul point de
vue qui distingue « l'API a répondu une erreur » de « l'API n'est pas lancée ».

Sont instrumentées les frontières — réseau, cache IndexedDB, service worker, envoi vers le
tricount — avec leur durée dès qu'il y a une attente. Le calcul de répartition ne l'est pas :
il a des tests. S'y ajoutent les appels `console.*` de la page (avertissements de React
compris) et les erreurs non rattrapées, qui arrivent ainsi au même endroit que le reste.

| Variable | Effet |
|---|---|
| `VITE_LOG_LEVEL` | Seuil : `debug`, `info`, `warn`, `error`, `silent`. Défaut : `debug` en dev, `warn` en production |
| `VITE_LOG_ECHO` | `1` pour écrire *aussi* dans la console du navigateur. Défaut : non |
| `VITE_LOG_CONSOLE` | `0` pour cesser de renvoyer les `console.*` de la page. Défaut : renvoyés |

En production, il n'y a pas de serveur à qui parler : seuls les avertissements et les erreurs
vont à la console du navigateur. **Jetons, clés et mots de passe sont masqués avant l'envoi** —
un terminal se relit à plusieurs et se colle dans des rapports.

Le canal tient en deux fichiers : `tools/vite-plugin-dev-log.ts` côté serveur,
`src/lib/log.ts` côté page.

---

## Docker
 
L'image Docker sert l'application statique via Nginx. Un reverse proxy en amont (comme Traefik) termine le TLS et achemine le trafic vers ce conteneur.
 
```bash
docker compose up -d --build
```
 
L'application écoute alors sur le port 8080 (`SPLITTICKET_PORT` pour en changer).
 
Sans Compose :
 
```bash
docker build -t splitticket .
docker run -d --name splitticket -p 8080:80 splitticket
```
 
Deux arguments de build, tous deux **publics** puisqu'ils sont intégrés au paquet livré :
 
| `--build-arg` | Effet |
|---|---|
| `VITE_API_URL` | URL publique de l'API (ex: `https://api.mondomaine.com`). Défaut : `/api` (utile pour le proxy Vite en dev local). |
| `VITE_SIGNUP_KEY` | Clé d'inscription, si l'instance en exige une pour enrôler un appareil. |
 
**N'y placez jamais de secret** : ni clé Gemini, ni mot de passe. La clé Gemini vit côté API,
chiffrée ; le jeton d'appareil est délivré par l'API et n'existe pas dans le build.
 
`docker/nginx.conf` sert l'application à la racine, gère le routage SPA (`try_files`) et le cache des assets statiques. Le conteneur écoute en HTTP ; terminez le TLS sur votre reverse proxy (indispensable pour l'installation PWA et le service worker).

---

## Parcours

```
Groupes ─→ Groupe ─→ Photo ─→ Lecture ─→ Vérification ─→ Attribution ─→ Résultats
   ↑          ↑                                                            │
   └──────────┴────────────────────────────────────────────────────────────┘
```

L'étape courante est mémorisée **sur le ticket, côté serveur** : le rouvrir plus tard, ou depuis
un autre appareil, reprend là où il avait été laissé. La saisie manuelle est accessible depuis
l'écran photo, pour tester la chaîne de calcul sans dépendre du modèle de vision.

**Hors ligne** : les groupes et tickets déjà consultés restent lisibles. Créer ou modifier
demande le réseau, et l'interface le dit — il n'y a pas de file de rejeu, parce que rejouer une
écriture sur un ticket qu'un autre membre a modifié entre-temps reviendrait à inventer de
l'argent.

**Édition concurrente** : chaque écriture porte la version qu'elle croit modifier. Si quelqu'un
est passé avant, le serveur refuse et l'application le dit, plutôt que d'écraser en silence.

**Adresses** : chaque écran a la sienne — `/`, `/g/{groupe}`, `/g/{groupe}/t/{ticket}/{étape}`.
Le geste retour du système recule d'un écran au lieu de quitter l'application, un lien s'ouvre
directement au bon endroit, et un rechargement ne ramène pas à l'accueil. Une adresse inconnue
retombe sur l'accueil plutôt que d'ouvrir un écran incohérent (`src/lib/routing.ts`).

**Compatibilité** : au démarrage, l'application compare sa version de contrat à celle annoncée
par `/health`. En cas d'écart — API et application déployées séparément — un bandeau le dit,
au lieu de laisser des échecs inexplicables se produire plus tard.

---

## Arithmétique au centime

Toutes les valeurs monétaires sont des **centimes entiers**. Aucun flottant ne représente jamais
de l'argent. Devise : dollar canadien.

Le partage d'une ligne entre plusieurs personnes utilise la **méthode du plus fort reste**
(`src/lib/split.ts`) : chacun reçoit la partie entière de sa part, et les centimes restants vont
aux plus fortes décimales, les égalités étant tranchées par l'ordre des participants — jamais au
hasard, pour que deux calculs identiques donnent le même résultat.

**Invariant fondamental** :
> Somme des montants dus === Sous-total attribué + Taxes réparties + Ajustements + Pourboire

Vérifié sur des tickets engendrés au hasard, avec bases de taxes mixtes, remises et pourboires.

> **Le calcul reste dans le navigateur.** `settle()` est déterministe à partir du ticket et
> alimente une interface vivante — le curseur de pourboire recalcule à chaque frappe. Le serveur
> ne le refait pas ; il revérifie l'invariant au moment de l'envoi vers Tricount, là où une
> erreur deviendrait irréversible.

### Taxes canadiennes

Contrairement aux tickets français où les prix sont TTC, **les prix canadiens sont hors taxes**.
TPS/GST, TVQ/PST ou TVH/HST s'ajoutent en pied de ticket.

Surtout, **la base taxable n'est pas le sous-total de chacun** : les aliments de base sont
détaxés. Chaque taxe se répartit sur *sa propre base* — la somme des lignes attribuées qui y
sont soumises. Qui n'a acheté que du lait et du pain ne paie pas la taxe sur la bière d'un autre.

Chaque ligne porte un indicateur de taxation, proposé par le modèle et corrigeable par une case
à cocher sur l'écran de vérification.

**Le montant imprimé fait foi.** L'application ne recalcule jamais une taxe à partir d'un
pourcentage : les arrondis de caisse varient, et c'est le papier qui a raison. Les taux ne sont
conservés qu'à titre indicatif.

### Pourboire

Le pourboire ne figure pas sur le ticket du commerçant : il n'entre donc pas dans le contrôle
`sous-total + taxes = total`, mais bien dans le total réparti.

Il se règle sur l'écran des résultats : pourcentages proposés, montant libre, et base de calcul
(par défaut le **sous-total avant taxes**, avec une option taxes comprises). Il se répartit au
prorata de la consommation de chacun, toujours par la méthode du plus fort reste.

---

## Lecture des tickets

L'appel au modèle de vision se fait **côté API**. Le navigateur n'a plus ni clé ni SDK Gemini :
il envoie une photo, il reçoit un ticket structuré.

Ce déplacement apporte une chose concrète : **le serveur écrit le résultat sur le ticket avant
de répondre**. Si la connexion tombe pendant les quelques secondes du modèle, rouvrir le ticket
montre la lecture. Le travail n'est plus perdu avec la requête.

```
src/capture/image.ts   Recadrage, rotation, réduction — avant l'envoi
app/extraction/        (côté API) Consigne, schéma, normalisation
```

### Garde-fous

- **Le recadrage et la réduction restent dans le navigateur** (≤ 1,6 Mpx, 1400 px de large) :
  c'est le seul moyen de n'envoyer qu'un ticket net et léger sur un réseau mobile.
- **Les montants sont demandés en chaîne, jamais en nombre.** Le modèle écrit `"12,90"`, et
  c'est l'analyseur qui décide ce que ça vaut. Aucun flottant produit par un LLM ne touche à de
  l'argent.
- **Normalisation stricte** : une ligne sans montant lisible est écartée et *nommée*, pas
  ramenée à zéro ; une quantité aberrante retombe à 1 ; une date inventée devient nulle ; une
  taxe sans montant est rejetée ; `GST` et `TPS` sont ramenés au même code pour éviter de
  compter deux fois.
- **Écran de vérification** : le bandeau `sous-total + taxes = total imprimé` révèle une
  hallucination immédiatement. Les lignes que le modèle dit incertaines sont marquées.

---

## Tricount

> [!CAUTION]
> Tricount (bunq) **ne publie aucune interface programmable**. L'API passe par un client Android
> rétro-conçu. Les points d'entrée peuvent cesser de fonctionner sans préavis, et cet usage sort
> des conditions d'utilisation du service.

Un groupe **est** un tricount : il n'y a ni relais à configurer, ni jeton à coller, ni lien à
ressaisir au moment d'envoyer. Il ne reste qu'une question — qui a payé.

Les parts sont envoyées avec les **uuid** des membres. L'appariement par nom, qui échouait sur
un accent ou une majuscule, n'existe plus.

### Repli en texte, toujours fiable

Le bouton « Copier le récapitulatif » produit :

```
Chez Victoire — 14/03/2026
Sous-total : 50,00 $ · taxes : 7,49 $
Pourboire : 9,00 $
Total : 66,49 $

Mathieu : 39,89 $
Léa : 26,60 $
```

Un bouton de copie par personne permet de coller le montant exact dans Tricount ou n'importe
quelle application de paiement. Fonctionne toujours, quoi qu'il arrive en amont.

---

## Design

Jetons minimalistes (`src/styles/tokens.css`) : cinq gris, l'ambre réservé aux alertes d'écart,
et six teintes désaturées pour les badges de participants. Pas de vert de validation ni de
dégradé décoratif : **un état correct se signale par l'absence d'alerte**. Chiffres tabulaires
pour tous les montants.

---

## Structure

```
src/
  api/          Client HTTP, et la traduction domaine ↔ API
  lib/          Calcul financier, répartition, taxes, pourboire, export, journal
  capture/      Recadrage, rotation, compression de l'image
  db/           Cache IndexedDB, jeton d'appareil, préférences locales
  store/        État Zustand, écriture différée, arbitrage des conflits
  ui/           Primitives : écran, boutons, feuilles, badges, montants
  screens/      Groupes, groupe, et les cinq étapes d'un ticket
  integrations/ Envoi vers Tricount
  styles/       Jetons et feuille unique
tools/          Plugin Vite : les logs du navigateur vers le terminal
docker/         Configuration nginx de production
```

---

## Licence

Projet libre.
