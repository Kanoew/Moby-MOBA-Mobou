# Lot 3 du plan — effets de combat

## Base et périmètre

Branche `feat/combat-effects`, créée depuis `1d87c32` (`feat/hybrid-camera-polish`, PR #12). Cette base inclut le dernier `main` `3b49fbb` (0.12.0) et le lot 2 de Claude (`c8a2e09`). La PR du lot 3 cible la branche caméra pour isoler les deux revues ; elle est à intégrer après la PR #12.

Aucune modification de `src/sim/`, `data/`, des assets, des statistiques, cooldowns, dégâts, règles de mouvement ou de visibilité. Aucun nouveau système de critique ou de série d’éliminations. Aucun déploiement.

## Fichiers et changements

- `src/render/combat-fx.js` : lecture des événements d’impact, flash bref, impacts physiques/magiques, traînées pendant les fenêtres d’animation, sillages de dash, anneaux d’ultime et retour à l’armement des ronces ; chiffres regroupés, absorption explicite, effet d’élimination, secousses et budgets bornés.
- `src/render/renderer.js` : intégration autour des sprites existants et du HUD ; visibilité des effets, transformation partagée entre secousse et conversion du pointeur, expiration gelée pendant la pause.
- `src/ui/effects.js` : préférence complète/allégée persistante, priorité à la réduction des animations du système, tolérance au stockage indisponible.
- `src/ui/sound.js` : sons courts de lame, choc lourd, magie, lancement d’ultime et élimination, avec le réglage Son existant.
- `src/main.js`, `index.html` : bouton `#btn-effects` dans la pause et synchronisation de son état avec le système ; deux nouveaux modules ajoutés à la carte d’import via `npm run bump -- sync`.
- `tests/combat-fx.test.js` : 16 scénarios de synchronisation, annulation, projectile, bouclier, visibilité, budgets, pause, secousse, élimination, ultimes réels, préférence et neutralité de la simulation.
- `README.md`, `docs/ui-guide.md`, ce rapport : fonctionnement et vérifications.

## Limites de coût et de mouvement

- 64 groupes d’impact maximum en mode complet, 12 en allégé ; chaque groupe complet dessine au plus 8 éclats/pétales, un groupe allégé dessine un indicateur statique en fondu.
- 40 chiffres maximum en complet, 20 en allégé. Les coups sur la même unité dans une fenêtre de 90 ms sont regroupés. Les unités cachées ne reçoivent aucun nouvel effet spatial et les effets restants sont masqués dès la perte de vision.
- 64 surbrillances et 64 contextes de contact au maximum, rapidement expirés ; un seul bandeau d’élimination, 1,6 s. Les pièces/marqueurs existants sont plafonnés à 64, les chiffres d’or à 24.
- Sons d’impact espacés d’au moins 75 ms. Pas d’impact ni de son pour une préparation annulée ou une absorption totale.
- Secousse de 160 ms au plus, amplitude maximale 2,5 pixels CSS, pas de modification de l’état de la caméra ou de la simulation. Absente en allégé et non appliquée pendant visée, glissé ou maintien de la vue libre.
- Le mode allégé conserve les animations et zones de compétences existantes ; il retire les nouveaux ajouts décoratifs et les pièces animées.

## Vérifications automatisées

- `npm test` : 245 tests réussis, aucun échec, dont 16 nouveaux tests d’effets et la suite de la caméra et du lot 2.
- Chromium : trois héros × trois formats (844 × 390 et 667 × 375 en tactile DPR 2, 1440 × 900 sur PC). Impacts issus d’attaques réelles, fréquences sonores distinctes, lancement d’ultime, élimination réelle, préférence persistante après rechargement, prise en compte dynamique du mouvement réduit. Aucun `pageerror` sur les neuf parcours.
- Échantillon de charge Chromium en 844 × 390 DPR 2 : 500 événements d’impact injectés, 64 groupes retenus ; 100 appels de rendu avec les effets figés. Temps d’appel médian observé 10,7 ms, 95e percentile 12,4 ms ; positions/états des unités identiques avant/après rendu. Ce chronométrage JavaScript dans le navigateur de test ne mesure ni la présentation GPU ni les performances d’un téléphone physique.
- Captures des impacts et du bandeau d’élimination aux trois formats inspectées.

## Vérifications manuelles restantes

1. Sur iPhone et Android en paysage : comparer effets complets/allégés dans un combat groupé, vérifier les saccades et l’échauffement sur appareil de gamme moyenne.
2. Alterner attaque, déplacement, compétence, dash et ultime pour chaque héros ; vérifier que le nouveau retour n’avance ni ne retarde l’impact réel et que le tampon de commandes reste confortable.
3. Tester le volume réel des sons et leur coupure dans la pause, notamment pendant les ultimes et éliminations.
4. Viser une compétence et explorer la carte pendant un combat : vérifier l’absence de secousse sur la visée, l’alignement des clics et la stabilité du HUD.
5. Quitter la vision d’un adversaire : vérifier qu’aucun flash, nombre ou effet ne révèle sa position ; l’annonce d’une élimination créditée au joueur peut rester visible sans effet spatial.
6. Changer le réglage système de réduction des animations, reprendre l’application et vérifier le libellé ainsi que le mode allégé effectif. Tester également Safari mobile et les marges sûres du panneau de pause.

Le confort visuel, le volume sur haut-parleurs mobiles, les performances matérielles et Safari sur téléphone physique restent à valider.
