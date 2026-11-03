# SplitTicket — refonte visuelle « Classique »

Document de passation pour réappliquer le nouveau design sur l'app existante.

## Mission

L'app fonctionne déjà : scan du ticket, extraction par IA, attribution des plats, calcul des taxes et du pourboire au prorata, envoi vers Tricount. **Ne pas réécrire la logique métier.** Il s'agit de :

1. remplacer la couche visuelle par le design décrit ici ;
2. réorganiser le parcours d'un nouveau ticket en **trois étapes** (Plats, Ajustements, Envoi) ;
3. ajouter les quelques éléments d'UX manquants listés plus bas (« Nouveautés »).

Fichiers fournis :

- `tokens.css` : toutes les couleurs, tailles, rayons et la typo. À importer en racine ; aucune valeur en dur ailleurs.
- `maquette-classique.html` : maquette statique des trois écrans du parcours, à ouvrir dans un navigateur. C'est la référence visuelle ; les chiffres qu'elle contient sont un exemple réel et cohérent.

## Principes

- **Sombre, calme, sobre.** Fond graphite, une seule couleur claire (« Craie ») pour l'action principale. Pas de dégradés, pas d'ombres décoratives.
- **Une couleur par convive**, et seulement pour les convives. C'est le seul endroit où la couleur porte une information.
- **Chiffres alignés** : `font-variant-numeric: tabular-nums` partout, montants alignés à droite.
- **Séparateurs plutôt que cartes** pour les listes (filet 1px `--st-line`). Les cartes (`--st-surface` + bordure) sont réservées aux sections de réglages.
- Mobile d'abord (largeur de référence 390px), cibles tactiles ≥ 44px.

## Parcours

```
Compte
└── Liste des groupes Tricount liés
    └── Groupe : participants + historique des tickets envoyés
        └── Nouveau ticket
            ├── Photo du ticket (ou saisie manuelle)
            ├── Lecture par l'IA (chargement)
            ├── Étape 1 : Plats         ← maquette
            ├── Étape 2 : Ajustements   ← maquette
            └── Étape 3 : Envoi         ← maquette
```

Les écrans Groupes, Historique, Photo et Lecture ne sont pas maquettés : les construire avec les mêmes composants (en-tête, liste à filets, bouton principal en bas). Voir « Écrans non maquettés ».

## Composants

### En-tête d'écran
- Bouton retour : 44×44, `--st-surface`, bordure `--st-line`, rayon `--st-r-btn`, chevron 18px trait 2px.
- À droite : titre (nom du restaurant, 16/600) et sous-titre (`groupe, date`, 12px `--st-text-2`).

### Indicateur d'étape
- Ligne de texte : à gauche le nom de l'étape (12px `--st-text`), à droite « Étape N sur 3 » (12px `--st-text-2`).
- Dessous, une piste de 2px `--st-line` remplie en `--st-accent` à 33 / 66 / 100 %.

### Convives (étape 1)
- Rangée de 4 colonnes égales (au-delà de 4, défilement horizontal) : avatar rond 44px à la couleur du convive, initiales en 13/600 couleur `--st-bg`, prénom 12px `--st-text-2`, total courant 15/500.
- Convive sélectionné : double anneau (`0 0 0 2px --st-bg, 0 0 0 4px --st-text`), prénom en `--st-text`, total en 600.
- **Sous la rangée, une seule barre de répartition** : hauteur 6px, rayon 3px, segments séparés de 2px, largeur de chaque segment = part du total de la personne. Elle se met à jour en direct à chaque attribution.

### Ligne de plat
- Padding vertical 12px, filet du bas `--st-line`.
- Nom du plat 15px ; ligne secondaire facultative en 12px `--st-text-2` (ex. `2 × 36,95` pour une quantité, ou la ligne brute du ticket).
- Pastilles des personnes : 22px, initiales 9px, chevauchement -6px avec un liseré de 2px `--st-bg`.
- Prix à droite, 15/500, largeur min 56px.

### Section de réglages (`.sec`)
- Fond `--st-surface`, bordure `--st-line`, rayon 16, padding 12×14, gap 9.
- Titre 14/600 ; à droite, une précision (12px `--st-text-2`), un lien d'action (13/500) ou un montant (500).
- Lignes de détail : 14px `--st-text-muted`, libellé à gauche, montant à droite. Remise en `--st-discount` avec le signe « − » (vrai signe moins, pas un tiret).

### Contrôle segmenté
- Conteneur `--st-bg`, bordure `--st-line`, rayon 10, padding 3, gap 2.
- Segments de 32px de haut, 13px `--st-text-2` ; segment actif `--st-accent` / `--st-on-accent`, 600, rayon 7.

### Boutons
- Principal : 52px, plein largeur, `--st-accent`, texte `--st-on-accent` 15/600, rayon 12. Toujours en bas de l'écran.
- Secondaire : même gabarit, fond transparent, bordure `--st-line`, texte `--st-text`.
- Lien : texte souligné ou 13/500 `--st-text`, sans fond.

## Écrans

### Étape 1 — Plats
- En-tête, indicateur (33 %), rangée des convives + barre de répartition, liste des plats, bouton « Continuer ».
- Interaction : on sélectionne un convive en haut, puis on touche les plats pour les lui attribuer ou les retirer. Toucher un plat déjà attribué à d'autres l'ajoute en partage.
- Les totaux affichés sont **les totaux finaux** (taxes, remise et pourboire inclus) : ils bougent en direct.
- Conserver les fonctions existantes : appui long pour régler les parts, « Tout attribuer à la sélection », « Tout partager entre tous », règle « un plat non attribué est partagé entre tous ». Les placer dans un menu « ⋯ » de l'en-tête ou sous la liste, en liens discrets.
- L'ancien bloc « Ajustements » (écart de saisie, etc.) en bas de la liste part dans l'étape 2.

### Étape 2 — Ajustements
- En-tête, indicateur (66 %).
- Bloc total : « Total à répartir » (12px `--st-text-2`) puis le montant en `--st-fs-display` poids 300 ; à droite « plats 189,00 » en 12px.
- Section **Taxes** : précision « lues sur le ticket » ; une ligne par taxe détectée (TPS 5 %, TVQ 9,975 %). Toucher une ligne permet de la corriger ou de la désactiver.
- Section **Remise** : lien « Ajouter » ; une ligne par remise (libellé + montant négatif) ; segmenté « Au prorata | Sur des plats ». « Sur des plats » ouvre une sélection des plats concernés (feuille du bas).
- Section **Pourboire** : montant à droite ; segmenté « 15 % | 18 % | 20 % | Montant » (« Montant » ouvre un champ de saisie numérique) ; segmenté « Avant taxes | Après taxes ». Si l'IA a lu un pourboire sur le ticket, le préremplir et le signaler (« lu sur le ticket »).
- Écart de saisie / arrondi : une ligne de plus dans la section Remise ou une section « Autres » si nécessaire, même gabarit.
- Bouton « Continuer ».

### Étape 3 — Envoi
- En-tête, indicateur (100 %).
- Liste : une ligne par convive, avatar 36px, prénom 15px, détail en 12px `--st-text-2` (« plats 47,95, remise −2,54, taxes 6,80, pourb. 8,18 »), montant 18/500 à droite. Dernière ligne : « Total » + montant.
- Section « Payé par » (ligne cliquable, valeur à droite) : **à choisir avant l'envoi**, c'est le payeur de la dépense Tricount.
- Boutons : « Envoyer à Tricount » (principal), « Copier le récap » (secondaire). Le « Copier le détail » et « Marquer comme réglé » existants peuvent aller dans un menu « ⋯ ».
- Après l'envoi : écran ou feuille de confirmation avec le montant envoyé et un lien vers la dépense dans Tricount.

## Écrans non maquettés (à dériver)

- **Groupes** : titre « Groupes », liste à filets (nom du groupe, nombre de participants, date du dernier ticket), bouton principal « Lier un groupe Tricount ».
- **Groupe** : en-tête avec nom du groupe ; rangée d'avatars des participants (mêmes couleurs que dans le parcours) + lien « Rafraîchir » ; liste des tickets (nom, `date, N lignes` en 12px, montant à droite) ; bouton principal « Nouveau ticket ». Un ticket vide ou sans nom s'affiche « Ticket sans nom » en `--st-text-2`.
- **Photo** : zone de dépôt (bordure pointillée `--st-line`, rayon 16), conseils de prise de vue en 13px `--st-text-2`, bouton principal « Prendre ou choisir une photo », lien « Saisir le ticket à la main ».
- **Lecture IA** : la photo en vignette, un indicateur de progression sobre, le texte « Lecture du ticket… ». En cas d'échec : message clair, bouton « Réessayer », lien « Saisir à la main ».

## Nouveautés par rapport au prototype

1. Parcours en trois étapes avec indicateur de progression.
2. Totaux par personne en direct à l'étape 1, avec la barre de répartition.
3. Pourboire déplacé avant le récap, regroupé avec taxes et remises.
4. Remises : au prorata ou sur des plats précis.
5. Choix du payeur avant l'envoi.
6. Confirmation après envoi avec lien vers Tricount.

## Rédaction

Interface en français, phrases courtes, verbes d'action. Montants au format `60,39` (virgule, espace avant `$` quand le symbole est affiché). Un même bouton garde le même nom tout au long du parcours (« Continuer », « Envoyer à Tricount »).

## Accessibilité

- Contraste texte ≥ 4.5:1 (les couleurs du fichier de tokens respectent ce seuil sur `--st-bg`).
- Vrais `<button>` pour toutes les actions, `aria-label` sur les boutons sans texte (retour, menu).
- La barre de répartition porte un `aria-label` donnant la part de chacun.
- La couleur n'est jamais le seul repère : les initiales accompagnent toujours la couleur d'un convive.
