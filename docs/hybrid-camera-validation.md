# Lot 1 — complément caméra hybride

Base : `origin/main` au commit `3b49fbb`, version 0.12.0. Cette base inclut déjà la caméra initiale (0.11.0) et le lot 2 de Claude (`c8a2e09` : interpolation visuelle, filtre du joystick, glissement le long des murs).

## Fichiers et changements

- `src/render/camera.js` : exploration ancrée au terrain pendant le glissé et le maintien ; recentrage dès la prochaine image, sans délai et sans décalage de visée résiduel ; garde contre les coordonnées non finies.
- `src/input/pointer.js` : annulation explicite des gestes, traitement de la perte de capture, blocage des entrées pendant les panneaux et interruptions, maintien des commandes souris et du HUD.
- `src/main.js` : séparation de la caméra et de la visée tactile ; annulation sur pause, panneau, rotation bloquée, perte de focus et nouvelle partie ; conversion actualisée du pointeur souris pendant le suivi ; recentrage au clavier et état accessible du maintien.
- `index.html`, `styles/ui.css` : état `aria-pressed` et position du bouton caméra sous la mini-carte sur PC, tout en conservant sa cible tactile de 44 px et les marges sûres.
- `tests/camera.test.js` : six scénarios supplémentaires sur le cadre libre avec héros mobile, le recentrage immédiat et le routage/annulation des gestes.
- `README.md`, `docs/ui-guide.md`, ce document : commandes, comportement et validation.

La simulation, les réglages de combat, les assets, le brouillard, les règles de ciblage et l’interpolation du lot 2 restent ceux de la base. Aucun nouveau module ni dépendance ; carte d’import déjà à jour. Aucun déploiement.

## Vérifications exécutées

- `npm test` : 229 tests réussis, aucun échec, dont les tests de combat du lot 2, de visibilité et de caméra.
- Chromium, gestes tactiles via CDP, DPR 2 : 844 × 390 et 667 × 375. Glissé sans commande, retour automatique, joystick et caméra avec deux doigts, maintien de la vue pendant le déplacement du héros, bouton de recentrage, séparation visée/caméra, pause en cours de glissé. Aucun événement `pageerror`.
- Chromium, 1440 × 900 : glissé au bouton du milieu, flèches, recentrage Espace et Entrée sur le bouton, déplacement au clic. Aucun événement `pageerror`.
- Captures des trois formats inspectées ; bouton caméra sous la mini-carte et commandes accessibles.

## Vérifications manuelles restantes

1. Sur iPhone et Android en paysage, courir et effectuer des dashs : vérifier le confort du suivi et l’absence de retard gênant.
2. Garder le joystick engagé, explorer avec un second doigt puis relâcher : vérifier le délai de retour de 1,2 s et le retour progressif.
3. Maintenir la caméra libre, continuer à courir et viser une compétence ; recentrer au bouton.
4. Interrompre un glissé par rotation, ouverture d’un panneau ou mise en arrière-plan : vérifier qu’aucune sélection ou capture ne persiste.
5. Explorer le côté adverse : vérifier que les zones restent sombres et les unités cachées non ciblables ; contrôler le cadre de la mini-carte.
6. Sur téléphone physique de gamme moyenne, mesurer le rythme des images et tester les encoches/marges sûres. L’émulation Chromium ne valide ni le GPU mobile, ni le toucher natif de Safari, ni les performances matérielles.
