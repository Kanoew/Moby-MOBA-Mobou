# Moby-MOBA-Mobou — MOBA 3v3

Prototype jouable du cahier des charges (`MOBA 3v3 · Cahier des charges`). État actuel : **lot 1 · Terrain et combat**, **lot 2 · Match 3v3 local** et **lot 3 · Progression et jungle**.

Trois compagnons jouables, mêmes des deux côtés : **Yeji** (katana, mêlée rapide), **Sweetie** (épée, mêlée lourde), **Jennie** (bouquet, projectile à distance). Le joueur contrôle un héros, deux bots l'accompagnent contre trois bots.

Aucune dépendance : un navigateur récent et Node ≥ 20.

## Lancer

```bash
npm start            # http://localhost:8000   (PORT=8123 npm start pour changer de port)
npm test             # tests de la simulation (node --test)
```

Options d'URL : `?hero=yeji|sweetie|jennie` (héros du joueur) · `?mode=duel` (salle d'entraînement du lot 1, Yeji contre Jennie) · `?bot=off` (adversaires inertes) · `?speed=N` (match accéléré, jusqu'à ×20) · `?seed=N` (tempérament des bots) · `?debug=1` (portées, distances, états) · `?level=N` (donne l'XP du niveau N au joueur, pour tester) · `?spend=1` (avec `level`, dépense aussitôt les points).

Commandes au clavier-souris : clic sol = se déplacer · clic ennemi, sbire, monstre ou tour (ou appui) = verrouiller · `Q` = viser la compétence (clic ou `Q` pour lancer, `Échap` ou clic droit annule) · `R` = ultime · `1` / `2` = +auto / +skill (ou choix de ligne quand l'invite du boss est ouverte) · boutons « + » de la barre de capacités · `S` = stop · `D` = debug · `N` = rejouer · `Échap` = pause.

## Interface, mobile et version

- **Accueil** avec Jouer, Personnages et Boutique. **Personnages** : fiche (stats, compétences, recharges) et choix du héros. **Boutique** : achat de personnages avec des Éclats gagnés en partie (victoire 150, égalité 80, défaite 50) ; personnage de départ : Yeji ; Sweetie et Jennie coûtent 300. Le profil est enregistré dans le navigateur (`localStorage`). Aucun paiement réel.
- **Mobile, paysage uniquement** : en portrait, un écran « Tournez votre appareil » couvre le jeu et met la partie en pause ; le jeu tente aussi de verrouiller l'orientation (plein écran, `screen.orientation.lock`, manifeste `landscape`).
- **Commandes tactiles** : joystick flottant à gauche (il apparaît sous le pouce), boutons Attaque, Compétence, Ultime à droite, boutons « + » pour les points. Appui sur Attaque : verrouille l'ennemi le plus proche à portée. Compétence : appui = visée automatique, glissé = viser puis relâcher pour lancer. Le sol ne déplace pas sur écran tactile. `?touch=1` les affiche sur ordinateur.
- **Version** : numéro unique dans `version.json`, appliqué à tous les fichiers chargés (`?v=…`) par une carte d'import générée. `npm run bump` avant chaque publication (`-- minor`, `-- major`, `-- sync`). Le jeu se recharge de lui-même si le serveur annonce une version plus récente. Détails dans `docs/ui-guide.md`.
- **Habillage** : `docs/ui-guide.md` liste ce qui est fait, ce qui reste (images, HUD du canvas) et les identifiants à conserver.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `src/sim/` | Simulation pure (aucun DOM, aucune horloge réelle). `world.js` : commandes, héros, sbires, tours, noyaux, vagues, mort/réapparition, dégâts, collisions. `abilities.js` : lancers, dash, projectiles en éventail, zones, ralentissement, bouclier. `progression.js` : XP, niveaux, rangs. `jungle.js` : camps, boss, récompense. `path.js` : A* + lissage. `bot.js` : IA, n'utilise que `issueCommand`. Prête à tourner côté serveur au lot 5. |
| `src/render/` | Rendu canvas. `animator.js` (choix d'image, pur et testé), `renderer.js` (lit l'état, ne le modifie pas). |
| `src/input/` | Souris → commandes (`pointer.js`). |
| `src/ui/` | Accueil, personnages, boutique (`screens.js`), profil local (`profile.js`), commandes tactiles (`touch.js`). |
| `styles/`, `manifest.webmanifest`, `version.json`, `tools/bump-version.mjs` | Feuille de style, manifeste paysage, version et outil de version. |
| `data/` | `heroes.json` (stats, auto, compétences et ultimes par rang, durées d'images, planches, effets), `match.json` (vagues, sbires, monstres, boss, tours, noyau, progression, camps, tableau de réapparition, zone de départ), `map-3v3.json` (lignes, tours, noyaux, obstacles), `arena.json` (duel). Tout l'équilibrage est ici. |
| `assets/` | Planches copiées des packs fournis (compagnons, attaques, dash et ultime de Yeji avec ses effets d'orbite, ruée et bouclier de Sweetie, triple bouquet et couronne de ronces de Jennie). Planches des monstres (gnome, troll, fleur, dragon, cerbère et ses flammes). Tours et noyaux sont encore dessinés par le code. |

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
- **Horloge** : 0:00 les six héros sont dans leur zone de départ ; **0:05** les sorties s'ouvrent (avant, les héros sont confinés) ; **0:30** première vague, puis toutes les 25 s (3 gnomes + 1 troll par ligne et par équipe, étalés de 450 ms).
- **Tours** : visent d'abord les sbires à portée, puis les héros. Un héros qui frappe un héros allié de la tour, tout en étant à portée de celle-ci, attire ses tirs pendant 2,5 s.
- **Mort** : délai interpolé linéairement (5 s jusqu'à 2 min, 11 s à 5 min, 20 s à 9 min et après), arrondi à la seconde. Le héros réapparaît dans sa base avec ses PV pleins. Compteurs éliminations / morts / assistances (assistance : un coup au héros tué dans les 10 s précédentes, sans le coup final).
- **Base** : soin de 8 % des PV max par seconde dans sa propre zone de départ.
- **Bots** : tiennent une ligne (Jennie alterne), suivent leur sbire le plus avancé, évitent de se tenir sous une tour sans sbire allié à sa portée, se replient à bas PV (seuil propre à chaque bot, tiré de la graine), se soignent et reviennent à pied. Ils utilisent exactement les mêmes commandes que le joueur.
- **Interface minimale** : chrono, éliminations et tours, PV du joueur, compte à rebours de réapparition, minimap (un ennemi n'y apparaît que s'il est vu par un allié). Le HUD complet, la boutique et le tableau des scores sont le lot 4.

## Règles du lot 3 (cahier §1 et §2)

**Progression.** Niveaux 1 à 9 (seuils d'XP dans `match.json`). Niveau 1 : auto rang 1. Niveaux 2, 4, 5, 7 et 8 : un point à dépenser, en auto ou en skill, jusqu'au rang 3 chacun (cinq points = rang 3 partout). Niveaux 3, 6 et 9 : l'ultime prend le rang 1, 2 puis 3 automatiquement, même si des points restent en attente. Les points se gardent dans le HUD. Chaque niveau augmente PV, Attaque et Défense ; le rang d'auto ajoute +15 % puis +30 % de dégâts. L'XP est au prorata **du temps passé et des monstres tués** : 2 XP par seconde pour tout héros vivant, plus les kills (gnome 16, troll 30, petite unité de camp 30, grande 70, Cerbère 300, héros 80 + 25 par niveau), partagés entre les héros de l'équipe à moins de 1000 px. Les bots atteignent en moyenne le niveau 5 à 4 minutes et le niveau 8 à 8 minutes.

**Compétences** (une recharge propre à chacune, les dégâts utilisent l'Attaque selon un coefficient ; les instants viennent des packs d'animation) :

| Héros | Skill (rang 1 / 2 / 3) | Ultime (niveau 3 / 6 / 9) |
| --- | --- | --- |
| Yeji | **Coupe éclair** : dash de 340 / 380 / 420 px, la coupe frappe à 185 ms, **traverse** et touche chaque ennemi une fois. Vers la cible verrouillée si elle est à portée, sinon vers la visée. Recharge 5 s. | **Cercle des lames** : zone de rayon 200 qui **suit Yeji** pendant 4 s et **ralentit de 30 / 40 / 50 %**. Aucun dégât. Pose à 160 ms. Recharge 45 s. |
| Sweetie | **Ruée** : dash de 260 / 290 / 320 px sur 340 ms (courbe fournie), **s'arrête au contact** de la première cible, qu'elle seule touche. Recharge 5 s. | **Bouclier** : absorbe 150 / 250 / 350 pendant 4 s, actif à 220 ms, retiré à 4 220 ms après le lancer. Absorbe **après la Défense, avant les PV**. Sweetie seule. Recharge 45 s. |
| Jennie | **Triple bouquet** : trois bouquets à −15°, 0° et +15° (sens horaire à l'écran) à 235 ms, en ligne droite, chacun touche le premier ennemi rencontré. Portée 600 / 640 / 680. Recharge 5 s. | **Couronne de ronces** : anneau de rayon 230 posé à 180 ms sur place (il ne suit pas Jennie), visible puis armé après 0,6 s : dégâts d'armement, puis dégâts périodiques pendant 3 s. Recharge 45 s. |

**Recharges** (réglage de départ) : **5 s pour tous les skills, 45 s pour tous les ultimes**, à tous les rangs. Un lancer occupe le héros jusqu'à la fin de son animation (un ordre de déplacement est refusé). Les ralentissements ne s'empilent pas : le plus fort s'applique, avec un plancher à 40 % de la vitesse.

**Monstres des lignes.** Chaque vague compte **trois gnomes et un troll** par ligne et par équipe (le sbire à distance du lot 2 est retiré : aucune planche ne le couvrait). Le troll est plus gros, plus lent, plus résistant et rapporte plus d'XP.

**Jungle.** De **chaque côté**, un camp de fleurs carnivores et un camp de dragons : une grande unité au centre et deux petites sur les côtés (positions et échelles du pack). Les camps de l'autre côté sont le miroir exact (mêmes distances d'accès pour les deux équipes). Ils apparaissent à 0:30, sont passifs tant qu'on ne les frappe pas, puis **tout le camp riposte ensemble**. Ils abandonnent la poursuite hors de leur laisse, reviennent se soigner, et réapparaissent 60 s après avoir été nettoyés.

**Cerbère (boss).** Annonce à **3:15**, apparition à **3:30** au centre exact de la carte. Mort à 4:10 → retour à **7:40** (3:30 après sa mort ; nouvelle annonce 15 s avant). Deux attaques : une **morsure** (impact à 320 ms) et un **souffle de braises** en cône de 35° sur 320 px (départ à 510 ms, toutes les 7 s), qui touche aussi les héros et sbires alentour. Calibré pour qu'un duo (Yeji + Jennie niveau 4) le batte en moins de 40 s sans perdre un héros.

**Durée de la partie.** Limite de **10 minutes** (`timeLimitMs` dans `match.json`) : à 10:00 la partie s'arrête et l'équipe qui a le plus entamé les structures adverses gagne, puis les éliminations, sinon égalité. Contre un héros inactif, trois bots détruisent le noyau en 6 à 7 minutes ; deux équipes de bots identiques ne se départagent pas toutes seules et finissent à la limite.

**Vague renforcée.** L'équipe qui porte le dernier coup gagne deux brutes en plus dans une vague. Le joueur crédité choisit **haut ou bas** pendant 10 secondes via l'invite du HUD (boutons ou touches `1` / `2`) ; sans choix, ligne par défaut (haut, réglable dans `match.json`). Le bonus est consommé par la prochaine vague de cette équipe sur cette ligne, une seule fois.

**Bots.** Dépensent leurs points, lancent skill et ultime selon des règles simples (dash pour rejoindre un héros, éventail à portée, ultime quand des ennemis sont dans la zone, bouclier quand ils sont blessés). Jennie, sans ligne attitrée, fait la jungle quand aucune ligne n'est menacée. Jennie et Sweetie (ligne du bas) prennent le boss en duo quand les deux sont en forme. Un bot blessé et au calme remonte se soigner.

## Limites connues

- **Pas d'or ni de boutique** (lot 4). L'XP et les niveaux existent.
- **Sbires** : ils suivent la ligne en ligne droite, sans collision avec les obstacles ni avec les héros, et s'écartent seulement les uns des autres.
- **Équilibrage** : valeurs de départ (structures : tour extérieure 1300 PV, intérieure 1600, noyau 2000). Deux équipes de bots identiques s'annulent (les vagues se rencontrent au milieu, rien ne bascule) ; la partie se décide dès qu'un humain ou un déséquilibre intervient. Une équipe de trois bots détruit le noyau d'un héros inactif en environ 12 à 18 minutes.
- **Crédit d'élimination** : seul un héros qui porte le coup final obtient l'élimination ; un coup final de sbire ou de tour donne des assistances mais pas d'élimination.
- Les monstres traversent les obstacles en ligne droite, sans collision entre eux.
- L'arrêt sur impact de 45 ms de Sweetie, prévu dans son pack, n'est pas implémenté.
- Le HUD de visée est un aperçu simple (couloir du dash, trois lignes de l'éventail) ; pas encore de commandes tactiles pour les compétences (lot 4).
- Les points de compétence se dépensent à la souris ou aux touches `1` / `2` ; pas de raccourci clavier par rang.
- Le duel du lot 1 se termine à la mort d'un héros (`?mode=duel`) ; le match 3v3 utilise la réapparition.

## Vérifier le lot 3

En jeu, avec `?level=3&spend=1&bot=off` pour avoir skill et ultime tout de suite :

1. `Q` : un aperçu apparaît (couloir pour Yeji et Sweetie, trois lignes pour Jennie). Clic pour lancer. La barre de capacités affiche la recharge.
2. Yeji : le dash traverse deux ennemis alignés et les touche une fois chacun ; `R` pose une zone qui te suit, un ennemi qui s'y trouve ralentit.
3. Sweetie : le dash s'arrête sur le premier ennemi ; `R` fait apparaître le bouclier, qui disparaît à 4 s.
4. Jennie : trois bouquets partent en éventail ; `R` pose l'anneau de ronces, qui inflige des dégâts après un court délai.
5. À 0:30 les camps apparaissent ; à 3:15 une annonce, à 3:30 le Cerbère au centre : approche-toi de lui, il alterne morsure et souffle en cône. Tue-le avec un autre héros : l'invite « Vague renforcée » s'ouvre, choisis `1` ou `2`.
6. Monte de niveau (`?level=2`) : le bouton « + » apparaît sur Attaque et sur la compétence ; l'ultime se débloque au niveau 3.

## Vérifier le lot 2

À la main, avec `?speed=4` pour aller plus vite :

1. À 0:01, tenter de sortir de la zone : le héros reste dedans jusqu'à **0:05**.
2. À **0:30** les premières vagues partent ; elles se rencontrent près du centre de chaque ligne vers 0:45.
3. Verrouiller une tour intérieure : le clic se transforme en déplacement tant que l'extérieure vit (cristal creux, libellé « protégé »).
4. Se placer sous une tour ennemie avec un sbire allié près d'elle : la tour tire sur le sbire. Frapper un héros ennemi à portée de sa tour : elle se retourne contre vous.
5. Mourir : compte à rebours au centre de l'écran, réapparition dans la base en PV pleins, compteur de morts incrémenté.
6. Détruire deux tours d'une même ligne puis le noyau : écran Victoire.

En automatique : `npm test` (101 tests) couvre le tableau de réapparition, la sortie à 0:05, les vagues à 0:30, l'invulnérabilité en cascade, la fin de partie, la priorité des tours, l'assistance, le soin en base et les bots (destruction du noyau d'un héros inactif, repli puis retour en lane). Le lot 3 est couvert par `tests/lot3.test.js` (niveaux et rangs, partage d'XP, dash qui traverse ou qui s'arrête, éventail, bouclier et son expiration à 4 220 ms, zones et ralentissements, camps, laisse, boss à 3:15 / 3:30 / 7:40, duo contre le boss, vague renforcée et choix par défaut) et `tests/animator.test.js` (images, directions, échelles). `tests/ui.test.js` couvre la boutique et le profil, la cohérence des versions et de la carte d'import, le joystick, les boutons d'action et la commande `steer`. `tests/balance.test.js` couvre les recharges, l'XP du temps et des kills, la limite de 10 minutes, les camps symétriques, le souffle du Cerbère et la synchronisation données ↔ animations (impact à la 4e image, durées, fichiers présents).

## Hors périmètre

Boutique, objets, rappel, HUD complet, tableau des scores, commandes tactiles (lot 4) ; salle privée en ligne (lot 5).

## Question ouverte

Voir `docs/kits-heros.md` : les kits y sont décrits tels que construits. Restent à arbitrer l'équilibrage (recharges, dégâts, rayon des zones) et le comportement des bots autour du boss.
