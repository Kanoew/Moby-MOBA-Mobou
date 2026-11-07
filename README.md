# Moby-MOBA-Mobou — MOBA 3v3

Prototype jouable du cahier des charges (`MOBA 3v3 · Cahier des charges`). État actuel : **lot 1 · Terrain et combat** — deux héros, une petite arène, déplacement, collisions, verrou, autos et barres de PV.

- **Yeji** : katana, mêlée (le pack « corps à corps »).
- **Jennie** : bouquet, projectile à distance (le pack « lancer de bouquet »), contrôlée par un bot.

Aucune dépendance : un navigateur récent et Node ≥ 20.

## Lancer

```bash
npm start            # http://localhost:8000   (PORT=8123 npm start pour changer de port)
npm test             # tests de la simulation (node --test)
```

Options d'URL : `?hero=jennie` (jouer Jennie, le bot prend Yeji) · `?bot=off` (adversaire inerte) · `?debug=1` (portées, distances, états).

Commandes : clic sol = se déplacer · clic ennemi (ou appui) = verrouiller · `S` = stop · `D` = debug · `R` = rejouer.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `src/sim/` | Simulation pure (aucun DOM, aucune horloge réelle). `world.js` : commandes, autos, projectiles, dégâts, collisions. `path.js` : A* + lissage. `bot.js` : IA, n'utilise que `issueCommand`. Prête à tourner côté serveur au lot 5. |
| `src/render/` | Rendu canvas. `animator.js` (choix d'image, pur et testé), `renderer.js` (lit l'état, ne le modifie pas). |
| `src/input/` | Souris/tactile → commandes. |
| `data/` | `heroes.json` (stats, portée, cadence, durées d'images, planches), `map.json`. Tout l'équilibrage est ici. |
| `assets/` | Planches copiées des packs fournis (compagnon, katana, attaque et projectile de Jennie). |

## Règles implémentées (cahier §2)

- Clic sur un ennemi : verrou. Les autos se répètent tant que la cible est vivante, visible et **à portée** (bord à bord), à la cadence propre au héros.
- Cible hors portée : verrou conservé, attaque en pause, **aucune poursuite automatique**.
- Cible morte ou invisible : désélection.
- Déplacement : suspend les autos (un coup non encore arrivé à l'impact est annulé et ne consomme pas la cadence). Arrêté, le héros reprend ses autos si la cible est à portée.
- Dégâts = Attaque × 100 / (100 + Défense) : une seule Défense.
- Impacts synchronisés avec les animations : katana à l'image 2 (**400 ms**), bouquet `spawn_projectile` à l'image 4 (**240 ms**), une seule apparition par attaque.
- Coup de mêlée raté si la cible a quitté la zone entre le départ et l'impact (`whiff`).

## Vérifier ciblage, portée et arrêt des attaques

À la main, avec `?debug=1&bot=off` : la ligne de debug affiche la cible, la distance bord à bord, la portée et l'état.

1. Cliquer l'ennemi loin de Yeji : anneau jaune sur lui, `bord-à-bord > portée`, **Yeji ne bouge pas et n'attaque pas**.
2. Cliquer au sol pour se rapprocher : pendant la marche, aucun coup. À l'arrêt, dès que `bord-à-bord ≤ portée`, les coups partent (un chiffre de dégâts toutes les 1,1 s).
3. En plein coup, cliquer ailleurs : le coup s'interrompt, aucun dégât.
4. Un coup de katana ne touche qu'à 400 ms ; reculer avant (clic ailleurs) ne coûte rien.
5. Tuer l'ennemi : écran Victoire/Défaite, `R` relance.

En automatique : `npm test` couvre chacun de ces points (verrou, portée, pause, reprise, annulation, désélection, impact à 400 ms / 240 ms, collisions, chemins, bot).

## Hors périmètre du lot 1

Lanes, tours, vagues, XP/rangs, compétences, boutique, rappel, mort/respawn, réseau : lots 2 à 5 du cahier. À la mort d'un héros, le duel s'arrête (le respawn arrive au lot 2).

## Question ouverte

Le cahier prévoit « Épéiste » (Sweetie, grande taille) et « Protecteur » (coup court, bouclier, onde de recul). Yeji au katana prend la place du Protecteur dans ce lot : son skill et son ultime restent à définir.
