# Lot 4 du plan — HUD mobile

## Base et périmètre

Branche `feat/mobile-hud`, créée depuis `origin/feat/hybrid-camera-polish` au commit `ea26f5f` (fusion du lot 3, PR #13). `main` est au commit `cba3ecd` et inclut déjà le complément caméra, PR #12. La PR du HUD cible la branche caméra encore en avance pour conserver les effets de combat et isoler ce lot.

Maquette HTML/CSS préparée et inspectée avant l’intégration : `docs/mockups/mobile-hud.html`. Elle partage maintenant le style de production. Paramètres de comparaison : `?state=cooling`, `?state=locked`, `?state=aiming`, `?points=1`.

Aucun changement de `src/sim/`, de `data/`, des sprites, des dégâts, cooldowns, collisions, règles de visibilité ou choix des cibles. Aucun déploiement.

## Fichiers et changements

- `index.html` : informations mobiles accessibles en DOM, icônes SVG réutilisables et icônes dans les boutons existants. Identifiants historiques conservés. Nouvelle entrée du module dans la carte d’import.
- `styles/ui.css` : disposition paysage compacte, zones de 44 px minimum, recharge circulaire, états de capacité, améliorations fixes, marges sûres, commandes de ciblage repliées ; styles limités au tactile pour les nouvelles positions.
- `src/ui/mobile-hud.js` : modèle d’affichage pur et raccord DOM, score/temps/objectifs, vie/niveau/XP, cache de la géométrie de mini-carte.
- `src/ui/touch.js` : données et états de présentation des slots, libellés accessibles, icônes du héros, mises à jour qui conservent les boutons et les captures. Filtre du joystick et commandes inchangés.
- `src/ui/hud.js` : icône du Rappel conservée avec compteur court sur mobile ; nœuds d’inventaire stables entre les gains d’or ; gardes sur les panneaux indisponibles en duel.
- `src/render/renderer.js` : remplacement des informations mobiles dupliquées par le DOM, mini-carte déplacée selon son cadre et les marges sûres ; une notification courte sur mobile. HUD Canvas PC et projection/visibilité de la mini-carte conservés.
- `src/main.js` : raccord du HUD, mesure au démarrage, mise à jour après dessin et fermeture du menu de ciblage sur action extérieure ou Échap.
- `tests/mobile-hud.test.js` : cinq scénarios sur les équipes, objectifs, compteurs, vie/XP bornées, lecture sans mutation, états de capacité pour les trois héros et contrat des identifiants/icônes.
- `README.md`, `docs/ui-guide.md`, ce rapport et la maquette : documentation et vérifications.

`npm run bump -- sync` exécuté : 25 modules versionnés. Aucune dépendance ajoutée.

## Vérifications exécutées

- `npm test` : 250 tests réussis, aucun échec, incluant les lots 1 à 3 et les cinq nouveaux scénarios du HUD.
- Chromium : trois héros × deux résolutions tactiles, 844 × 390 et 667 × 375, DPR 2. Verrouillage initial, améliorations, états disponible/visée/recharge, masquage radial du cooldown, icône propre au héros, scores au bandeau, boutique, Rappel et interruption, menu de ciblage refermé après action. Aucun `pageerror`.
- Mesure des rectangles : outils, boutons d’action, filtres, améliorations et emplacements occupés atteignent 44 px minimum et ne se superposent pas ; inventaire plein testé.
- Marges simulées : gauche 44 px, droite 20 px, haut 4 px, bas 21 px. Commandes dans la zone sûre ; capture des appels Canvas confirmant que le dessin de la mini-carte suit son cadre DOM, sans changement de projection.
- Multi-touch réel via CDP : joystick maintenu avec un doigt et visée de compétence avec un autre ; capture du bouton conservée pendant les mises à jour du HUD. Les emplacements d’inventaire gardent leur identité pendant un gain d’or.
- Ciblage réel en 667 × 375 : Farm verrouille le sbire, Héros le héros adverse, Structures la tour, malgré la présence simultanée des trois catégories à portée. Pas de changement du sélecteur de cible de simulation.
- Parcours caméra rejoués aux deux formats mobiles et en 1440 × 900 : glissé, retour, maintien, recentrage, joystick simultané, visée et annulation sur pause ; souris, flèches et Espace/Entrée sur PC.
- PC : HUD mobile masqué, scores et déplacement au clic opérationnels. Duel : vie Canvas/attaque conservées, compétences inactives masquées ; touches de panneaux indisponibles sans erreur.
- Captures de la maquette et des deux formats de jeu inspectées, dont menu de ciblage, recharge, vie faible, inventaire plein et marges simulées.

## Performances et limites

Les géométries ne sont pas mesurées à chaque frame. Les nœuds d’information et d’icône sont conservés ; compteurs et attributs sont actualisés seulement si nécessaire. Trois petits anneaux CSS remplacent les voiles linéaires ; aucune police externe, image supplémentaire, animation de panneau permanente ou bibliothèque graphique n’est ajoutée. Les améliorations ne bougent plus en boucle.

L’émulation Chromium ne valide pas le GPU, le confort du toucher, les encoches réelles ou les particularités de Safari sur téléphone. Aucun débit d’images sur matériel physique n’est revendiqué.

## Vérifications manuelles restantes

1. Tester sur iPhone et Android en paysage, avec et sans encoche : lisibilité de la mini-carte, barres, chiffres, noms des trois héros et recharges en combat.
2. Tenir le joystick, viser puis relâcher une compétence, utiliser les améliorations et recentrer la caméra ; vérifier qu’aucune zone ne gêne les pouces.
3. Ouvrir/fermer Cibles puis choisir Farm, Héros, Structures et Stop ; confirmer la sélection, la fermeture du menu et l’accès immédiat à l’ultime.
4. Acheter trois objets et gagner de l’or ; vérifier la stabilité de l’inventaire et l’ouverture du bon objet dans la boutique.
5. Tester le Rappel, son interruption et les scores par le bandeau ; comparer les états mort, vie faible, niveau maximal et choix de vague du boss.
6. Sur téléphone de gamme moyenne, comparer effets complets/allégés avec combat groupé et recharges actives ; relever les saccades/échauffement. Refaire après rotation, passage en arrière-plan et changement du réglage de mouvement réduit.
7. Sur PC, vérifier clic, Q/R, A/C/V/X, P/B, Tab et commandes de caméra. Aucun déploiement n’a été lancé.
