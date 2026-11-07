# Moby-MOBA-Mobou — MOBA 3v3

Prototype jouable du cahier des charges (`MOBA 3v3 · Cahier des charges`). État actuel : **lot 1 · Terrain et combat** et **lot 2 · Match 3v3 local**.

Trois compagnons jouables, mêmes des deux côtés : **Yeji** (katana, mêlée rapide), **Sweetie** (épée, mêlée lourde), **Jennie** (bouquet, projectile à distance). Le joueur contrôle un héros, deux bots l'accompagnent contre trois bots.

Aucune dépendance : un navigateur récent et Node ≥ 20.

## Lancer

```bash
npm start            # http://localhost:8000   (PORT=8123 npm start pour changer de port)
npm test             # tests de la simulation (node --test)
```

Options d'URL : `?hero=yeji|sweetie|jennie` (héros du joueur) · `?mode=duel` (salle d'entraînement du lot 1, Yeji contre Jennie) · `?bot=off` (adversaires inertes) · `?speed=N` (match accéléré, jusqu'à ×20) · `?seed=N` (tempérament des bots) · `?debug=1` (portées, distances, états).

Commandes : clic sol = se déplacer · clic ennemi, sbire ou tour (ou appui) = verrouiller · `S` = stop · `D` = debug · `R` = rejouer.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `src/sim/` | Simulation pure (aucun DOM, aucune horloge réelle). `world.js` : commandes, héros, sbires, tours, noyaux, vagues, mort/réapparition, dégâts, collisions. `path.js` : A* + lissage. `bot.js` : IA, n'utilise que `issueCommand`. Prête à tourner côté serveur au lot 5. |
| `src/render/` | Rendu canvas. `animator.js` (choix d'image, pur et testé), `renderer.js` (lit l'état, ne le modifie pas). |
| `src/input/` | Souris/tactile → commandes. |
| `data/` | `heroes.json` (stats, portée, cadence, durées d'images, planches), `match.json` (vagues, sbires, tours, noyau, tableau de réapparition, zone de départ), `map-3v3.json` (lignes, tours, noyaux, obstacles), `arena.json` (duel). Tout l'équilibrage est ici. |
| `assets/` | Planches copiées des packs fournis (compagnons, katana de Yeji, attaques de Sweetie et Jennie, bouquet). Sbires, tours et noyaux sont dessinés par le code : aucun sprite n'existe encore. |

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

## Règles du lot 2 (cahier §1 et §3, mort)

- **Carte** : deux lignes reliées par une jungle (obstacles seulement, camps et boss au lot 3). Par camp : base, zone de départ, noyau, quatre tours (extérieure puis intérieure sur chaque ligne), huit au total.
- **Vulnérabilité** : l'extérieure est toujours attaquable ; l'intérieure seulement après la chute de l'extérieure de sa ligne ; le noyau dès qu'une ligne a perdu ses deux tours. Une cible protégée ne se verrouille pas (le clic devient un déplacement). Détruire le noyau termine la partie.
- **Horloge** : 0:00 les six héros sont dans leur zone de départ ; **0:05** les sorties s'ouvrent (avant, les héros sont confinés) ; **0:30** première vague, puis toutes les 30 s (3 sbires de mêlée + 1 à distance par ligne et par équipe, étalés de 450 ms).
- **Tours** : visent d'abord les sbires à portée, puis les héros. Un héros qui frappe un héros allié de la tour, tout en étant à portée de celle-ci, attire ses tirs pendant 2,5 s.
- **Mort** : délai interpolé linéairement (5 s jusqu'à 2 min, 11 s à 5 min, 20 s à 9 min et après), arrondi à la seconde. Le héros réapparaît dans sa base avec ses PV pleins. Compteurs éliminations / morts / assistances (assistance : un coup au héros tué dans les 10 s précédentes, sans le coup final).
- **Base** : soin de 8 % des PV max par seconde dans sa propre zone de départ.
- **Bots** : tiennent une ligne (Jennie alterne), suivent leur sbire le plus avancé, évitent de se tenir sous une tour sans sbire allié à sa portée, se replient à bas PV (seuil propre à chaque bot, tiré de la graine), se soignent et reviennent à pied. Ils utilisent exactement les mêmes commandes que le joueur.
- **Interface minimale** : chrono, éliminations et tours, PV du joueur, compte à rebours de réapparition, minimap (un ennemi n'y apparaît que s'il est vu par un allié). Le HUD complet, la boutique et le tableau des scores sont le lot 4.

## Limites connues

- **Pas d'XP, d'or ni de boutique** : les héros n'évoluent pas (lots 3 et 4). Pas de camps ni de boss (lot 3).
- **Sbires** : ils suivent la ligne en ligne droite, sans collision avec les obstacles ni avec les héros, et s'écartent seulement les uns des autres.
- **Équilibrage** : valeurs de départ. Deux équipes de bots identiques s'annulent (les vagues se rencontrent au milieu, rien ne bascule) ; la partie se décide dès qu'un humain ou un déséquilibre intervient. Une équipe de trois bots détruit le noyau d'un héros inactif en environ 12 à 18 minutes.
- **Crédit d'élimination** : seul un héros qui porte le coup final obtient l'élimination ; un coup final de sbire ou de tour donne des assistances mais pas d'élimination.
- Chaque compagnon n'a que son auto : compétences, ultimes et rangs sont au lot 3 (voir `docs/kits-heros.md`).
- Le duel du lot 1 se termine à la mort d'un héros (`?mode=duel`) ; le match 3v3 utilise la réapparition.

## Vérifier le lot 2

À la main, avec `?speed=4` pour aller plus vite :

1. À 0:01, tenter de sortir de la zone : le héros reste dedans jusqu'à **0:05**.
2. À **0:30** les premières vagues partent ; elles se rencontrent près du centre de chaque ligne vers 0:45.
3. Verrouiller une tour intérieure : le clic se transforme en déplacement tant que l'extérieure vit (cristal creux, libellé « protégé »).
4. Se placer sous une tour ennemie avec un sbire allié près d'elle : la tour tire sur le sbire. Frapper un héros ennemi à portée de sa tour : elle se retourne contre vous.
5. Mourir : compte à rebours au centre de l'écran, réapparition dans la base en PV pleins, compteur de morts incrémenté.
6. Détruire deux tours d'une même ligne puis le noyau : écran Victoire.

En automatique : `npm test` (34 tests) couvre le tableau de réapparition, la sortie à 0:05, les vagues à 0:30, l'invulnérabilité en cascade, la fin de partie, la priorité des tours, l'assistance, le soin en base et les bots (destruction du noyau d'un héros inactif, repli puis retour en lane).

## Hors périmètre

Jungle, camps, boss, rangs et compétences (lot 3) ; boutique, rappel, HUD complet, tableau des scores (lot 4) ; réseau (lot 5).

## Question ouverte

Voir `docs/kits-heros.md` : kits de Yeji et Sweetie (dash, bouclier, zone d'entrave) et deux questions ouvertes sur leurs ultimes.
