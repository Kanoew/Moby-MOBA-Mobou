# Guide de l'interface (à compléter : images et HUD)

Cette base est volontairement **sobre et fonctionnelle**. Elle est prête à recevoir des images et un habillage sans toucher à la logique. Ce document dit où intervenir et ce qu'il ne faut pas casser.

## Ce qui est fait

| Zone | Où | État |
| --- | --- | --- |
| Accueil (Jouer, Personnages, Boutique) | `index.html` `#screen-home`, `styles/ui.css` | Fonctionnel, fond en dégradé sans image |
| Personnages (liste, fiche, choix) | `#screen-characters`, `src/ui/screens.js` | Fonctionnel, portraits tirés des planches de jeu |
| Boutique (achat de personnages) | `#screen-shop`, `src/ui/screens.js`, `src/ui/profile.js` | Fonctionnel avec monnaie locale (Éclats), **aucun paiement réel** |
| Partie : commandes tactiles | `#touch`, `src/ui/touch.js` | Joystick flottant, Attaque, Compétence (appui ou glissé), Ultime, boutons « + » |
| Lobby de sélection (20 s, validation auto) | `#screen-lobby`, `src/ui/lobby.js` | Fonctionnel : sélecteur, équipes, minuteur, bots ; logique pure testée |
| Pause, fin de partie (verdict + Éclats) | `#pause`, `#endcard` | Fonctionnel |
| Verrouillage paysage | `#rotate`, `src/main.js` | Overlay en portrait + tentative de verrouillage |
| Numéro de version | `version.json`, `tools/bump-version.mjs` | Voir plus bas |
| Inventaire (or + 3 emplacements) | `#inventory`, `src/ui/hud.js` | Fonctionnel, icônes des objets fournies |
| Boutique à trois onglets | `#shop`, `src/ui/hud.js` | Fonctionnel (achat, revente, libellés de blocage) |
| Tableau des scores et table de l'écran de fin | `#scores`, `#end-table`, `renderScoreTable` | Fonctionnel, deux blocs de trois lignes |
| Boutons Scores, Boutique, Rappel | `#hud-buttons` | Fonctionnels, texte seulement |
| Sons | `src/ui/sound.js` | Bips WebAudio (sans fichier), coupables dans la pause |

## Ce qui reste (pour un habillage)

- **Images** : fond d'accueil, portraits illustrés, icônes des compétences, icônes de boutons, cadres.
- **HUD de partie dessiné sur le canvas** (`src/render/renderer.js`, fonctions `drawHud`, `drawAbilityBar`, `drawMinimap`, `drawBonusPrompt`, `drawToasts`) : chrono, éliminations, minimap, barre de PV du joueur. Il est lisible mais plat. Sur mobile, la barre de capacités du canvas est masquée au profit des boutons HTML.
- **Habillage des panneaux du lot 4** : boutique, tableau des scores, inventaire et boutons de partie sont fonctionnels mais sans image (cadres, onglets, fonds, icônes de boutons). Les icônes des objets sont dans `assets/items/<id>.png` (192 × 192).
- **Retour visuel de certains effets d'objets** : aucun indicateur sur le héros pour le Talisman ou l'Armure de mêlée.

## Où mettre les images (sans toucher au code)

| Besoin | Comment |
| --- | --- |
| Fond d'accueil | Dans `styles/ui.css`, bloc `.bg-art` : ajouter `background-image: url(../assets/ui/accueil.jpg)`. |
| Portrait illustré d'un personnage | Déposer `assets/ui/portraits/<id>.png`, puis renseigner `"portrait": "assets/ui/portraits/<id>.png"` dans `data/roster.json`. Sinon la première image de repos de la planche est utilisée. |
| Aspect des boutons d'action tactiles | Classes `.act`, `.act-attack`, `.act-skill`, `.act-ult` dans `styles/ui.css`. Remplacer `background` par une image ; les états `.ready`, `.cooling`, `.locked`, `.aiming` sont déjà posés par le script. |
| Joystick | `#stick-base`, `#stick-knob` (il apparaît sous le pouce, il n'a pas de position fixe). |
| Couleurs, polices, tailles | Variables en tête de `styles/ui.css` (`--gold`, `--ally`, `--enemy`, `--panel`, `--font`, `--u` = taille de base des boutons tactiles). |

## À ne pas casser

- **Identifiants du DOM** utilisés par le script : `#btn-play`, `#lobby-picker`, `#lobby-allies`, `#lobby-enemies`, `#lobby-timer`, `#lobby-bar`, `#lobby-validate`, `#lobby-note`, `#lobby-back`, `#btn-characters`, `#btn-shop`, `#btn-pause`, `#btn-resume`, `#btn-quit`, `#btn-again`, `#btn-menu`, `#game`, `#touch`, `#stick-zone`, `#stick-base`, `#stick-knob`, `#btn-attack`, `#btn-skill`, `#btn-ult`, `#plus-attack`, `#plus-skill`, `#rotate`, `#hud-buttons`, `#btn-scores`, `#btn-shop-open`, `#btn-recall`, `#btn-sound`, `#inventory`, `#inv-gold`, `#gold-val`, `#gold-gain`, `#inv-slots`, `#hud-toast`, `#shop`, `#shop-backdrop`, `#shop-tabs` (boutons `data-family`), `#shop-list`, `#shop-detail`, `#shop-action`, `#shop-close`, `#shop-gold`, `#shop-where`, `#scores`, `#scores-backdrop`, `#scores-body`, `#end-table`, `#end-title`, `#end-sub`, `#end-reward`, `#home-coins`, `#home-hero`, `#version-label`, `#char-grid`, `#char-detail`, `#shop-grid`, `#shop-note`, `[data-bind="coins"]`, `[data-go]`. On peut changer leur apparence et leur place, pas leur nom.
- **Éléments internes des boutons d'action** : `.name`, `.key`, `.cd-num`, `.lock-note`, `.pips i`. Le script y écrit le nom de la capacité, la recharge, le rang.
- **Le canvas `#game`** doit rester en `position: absolute; inset: 0`. Un canvas flexible dont la taille dépend de son contenu grossit sans fin sur un écran à densité 2 ou 3.
- **`index.html` entre les marqueurs** `<!--version:start-->…<!--version:end-->` et `<!--entry:start-->…<!--entry:end-->` : généré par `npm run bump`, ne pas éditer à la main.

## Version et cache du navigateur

Un numéro de version unique vit dans `version.json`. Chaque fichier chargé (modules, données, planches, feuille de style, manifeste) reçoit `?v=<version>` : changer le numéro force le navigateur à tout recharger.

- `npm run bump` : version suivante (patch). `npm run bump -- minor` ou `-- major`, ou `-- 1.2.3`.
- `npm run bump -- sync` : régénère `index.html` sans changer la version (après avoir **ajouté ou renommé un fichier dans `src/`** : la carte d'import doit le connaître, un test le vérifie).
- Bumper **à chaque publication**. Au démarrage, le jeu compare sa version à `version.json` du serveur et se recharge une fois si elle est plus récente.

## Mobile

- Le jeu se joue **en paysage uniquement** : en portrait, l'overlay `#rotate` couvre l'écran et la partie est en pause. Le verrouillage réel (`screen.orientation.lock`) ne marche qu'en plein écran ou en application installée ; iOS Safari ne le permet pas, d'où l'overlay.
- Sur écran tactile, le sol ne déplace pas : on se déplace au joystick (à gauche), on touche un ennemi pour le verrouiller. Le bouton Attaque choisit seul une cible (héros d'abord) et s'en approche ; classes `.pulse` (ordre donné) et `.miss` (aucun ennemi, secousse) posées par le script.
- La compétence se lance d'un appui (visée automatique : verrou, sinon ennemi proche, sinon regard) ou d'un glissé depuis le bouton (aperçu de la direction, lancement au relâchement).
- Essayer sur ordinateur : `?touch=1` dans l'URL affiche les commandes tactiles.

## Vérifier

`npm test` doit rester vert (163 tests). Il couvre le profil, la boutique du menu, la cohérence des versions, la carte d'import, le joystick, les boutons d'action, ainsi que l'or, les règles d'achat, les douze objets, le rappel et le tableau des scores.

## Boutique, scores, rappel : points d'attention pour l'habillage

- Les panneaux `#shop` et `#scores` sont des « feuilles » : un fond `.backdrop` qui ferme et consomme l'appui, et un `.panel`. Garder cette structure : c'est elle qui empêche un appui sur un panneau de devenir un ordre de déplacement.
- Dans la boutique, les lignes ont la classe `.row` avec les états `.selected`, `.owned`, `.starter`, `.poor` ; le bouton d'action `#shop-action` est verrouillé 0,7 s après un clic (anti double appui) : ne pas retirer cet état `disabled`.
- Le canvas dessine encore, par-dessus, le chrono / éliminations / tours (toucher cette zone ouvre les scores) et la minimap.
- Les tailles tactiles minimales (≈ 38–44 px) sont respectées ; les conserver en restylant.
- Le rappel est dessiné dans le canvas (cercle doré + jauge sous les pieds) ; le bouton `#btn-recall` affiche le temps restant.

## Habillage 0.7.0 — arène nocturne

L'accueil utilise `assets/ui/arena-dusk.svg`, un paysage vectoriel local, et les trois sprites de compagnons existants. Personnages, boutique et lobby reprennent cette ambiance turquoise/or. Les styles responsive et la préférence de mouvement réduit sont définis à la fin de `styles/ui.css`.

Le terrain Canvas affiche un sol texturé déterministe, des chemins de pierre et des obstacles facettés. Le décor ne modifie pas la simulation ni les collisions. L'échelle du HUD tient compte du ratio de pixels ; mini-carte et barre de vie sont compactées sur mobile, avec le niveau du joueur affiché près des PV. Les commandes de ciblage sont regroupées au-dessus de l'inventaire.

Validation : suite Node complète et parcours Chromium aux formats 1440×900, 844×390 et 667×375 (accueil, personnages, boutique, sélection, lancement et boutique en partie). Les contrôles de ciblage ont aussi été exercés sur PC et mobile. Les performances sur téléphones physiques restent à vérifier.
