# Moby-MOBA-Mobou — MOBA 3v3

Prototype jouable du cahier des charges (`MOBA 3v3 · Cahier des charges`). État actuel : **lot 1 · Terrain et combat**, **lot 2 · Match 3v3 local**, **lot 3 · Progression et jungle** et **lot 4 · Économie et interface** (or, douze objets, boutique, rappel dansé, tableau des scores, écran de fin).

Trois compagnons jouables, mêmes des deux côtés : **Yeji** (katana, mêlée rapide), **Sweetie** (épée, mêlée lourde), **Jennie** (bouquet, projectile à distance). Le joueur contrôle un héros, deux bots l'accompagnent contre trois bots.

Aucune dépendance : un navigateur récent et Node ≥ 20.

## Combat 0.9.0 : continuité des commandes

- Une commande de déplacement, de ciblage ou d'arrêt pendant une compétence est mémorisée et exécutée à la fin du lancer. La dernière intention remplace la précédente. Relâcher le joystick pendant le lancer annule donc le déplacement en attente ; un joystick maintenu reprend après le lancer.
- Une compétence prête peut être mise en attente pendant les dernières 160 ms du lancer courant. Les recharges et les niveaux requis restent respectés, et l'animation en cours n'est pas interrompue.
- En poursuite explicite, après l'impact d'une auto, le héros peut reprendre sa course si l'adversaire sort de portée. Cette récupération écourtée ne réinitialise pas la cadence.
- Après la perte d'une cible, l'attaque explicite peut enchaîner sur une autre cible déjà à portée, selon le filtre choisi. Sans cible admissible, elle s'arrête. Un déplacement manuel annule cet enchaînement ; un simple clic de verrou n'active pas cette assistance.
- Stop annule aussi le verrou et l'attaque en cours. Il ne retire pas un projectile déjà parti et ne coupe pas une compétence en cours : dans ce cas l'arrêt est mémorisé.

Ces changements reprennent les principes de continuité des commandes et de déplacement entre les coups courants dans les MOBA, sans reproduire les valeurs d'un titre particulier. Les timings d'impact restent synchronisés avec les animations existantes.

## Ajustements 0.8.0 : équipement, rythme et rendu

Les objets offensifs ajoutent maintenant de l'Attaque permanente, utilisée par les autos et les coefficients des compétences : Lame courte +10, Dague +24, Gants +22, Marteau +28, Grimoire +8, Catalyseur +14, Relique +18, Sceau +16. Ces statistiques s'ajoutent aux passifs déjà décrits ci-dessous. Elles se cumulent entre objets différents et disparaissent à la revente. La boutique affiche l'Attaque actuelle et sa valeur après achat/revente. Prix et règles d'achat restent identiques.

Les déplacements des trois héros sont accélérés de 12 % (Yeji 336, Jennie 325, Sweetie 314). Les compétences se rechargent en 5 / 4,5 / 4 secondes selon leur rang ; les ultimes restent à 45 secondes. Il s'agit d'une première passe d'équilibrage, à éprouver en partie.

Le terrain statique est mis en cache et reconstruit à l'ouverture des bases. Les images sont décodées avant l'entrée en jeu et la densité de rendu Canvas est plafonnée à 2, pour réduire la charge sur les écrans denses sans modifier les coordonnées tactiles. Les interfaces HTML conservent leur résolution native.

Mesure Chromium à 844×390, écran DPR 3, trois ultimes simultanés sur 180 étapes : temps CPU simulation + soumission du dessin médian 11,9 → 6,4 ms ; p95 14,7 → 9,9 ms. Ce microbenchmark synchrone ne mesure ni la cadence présentée à l'écran ni le GPU d'un téléphone physique. La première image reste plus coûteuse (construction du cache).

## Lancer

```bash
npm start            # http://localhost:8000   (PORT=8123 npm start pour changer de port)
npm test             # tests de la simulation (node --test)
```

Options d'URL : `?hero=yeji|sweetie|jennie` (héros du joueur) · `?lobbyMs=N` (durée du lobby de sélection, 20 000 ms par défaut) · `?mode=duel` (salle d'entraînement du lot 1, Yeji contre Jennie) · `?bot=off` (adversaires inertes) · `?speed=N` (match accéléré, jusqu'à ×20) · `?seed=N` (tempérament des bots) · `?debug=1` (portées, distances, états) · `?level=N` (donne l'XP du niveau N au joueur, pour tester) · `?spend=1` (avec `level`, dépense aussitôt les points).

Commandes au clavier-souris : clic sol = se déplacer · clic ennemi, sbire, monstre ou tour (ou appui) = verrouiller · `Q` = viser la compétence (clic ou `Q` pour lancer, `Échap` ou clic droit annule) · `R` = ultime · `1` / `2` = +auto / +skill (ou choix de ligne quand l'invite du boss est ouverte) · boutons « + » de la barre de capacités · `B` = rappel · `P` = boutique · `A` = attaque automatique (comme le bouton Attaque) · `Tab` maintenu = scores (ou toucher le score en haut) · `S` = stop · `D` = debug · `N` = rejouer · `Échap` = ferme un panneau, sinon pause.

## Interface, mobile et version

- **Accueil** avec Jouer, Personnages et Boutique. **Jouer ouvre le lobby de sélection** : 20 secondes pour choisir son personnage parmi ceux que l'on possède (les autres sont grisés, « Boutique »). « Valider » lance aussitôt la partie ; **si personne ne valide, le choix en cours est validé automatiquement** à 0 s. Les deux alliés bots prennent les deux autres personnages, les trois adversaires apparaissent « Choisit… » puis se verrouillent à des instants tirés d'une graine. Un allié bot qui avait déjà verrouillé rechoisit si vous changez de personnage. « Retour » ou `Échap` annule. « Rejouer » repasse par le lobby. **Personnages** : fiche (stats, compétences, recharges) et choix du héros. **Boutique** : achat de personnages avec des Éclats gagnés en partie (victoire 150, égalité 80, défaite 50) ; personnage de départ : Yeji ; Sweetie et Jennie coûtent 300. Le profil est enregistré dans le navigateur (`localStorage`). Aucun paiement réel.
- **Mobile, paysage uniquement** : en portrait, un écran « Tournez votre appareil » couvre le jeu et met la partie en pause ; le jeu tente aussi de verrouiller l'orientation (plein écran, `screen.orientation.lock`, manifeste `landscape`).
- **Commandes tactiles** : joystick flottant à gauche (il apparaît sous le pouce), boutons Attaque, Compétence, Ultime à droite, boutons « + » pour les points. Appui sur Attaque : **ciblage automatique** (voir « Bouton Attaque » plus bas), sans avoir à toucher l'ennemi. Compétence : appui = visée automatique, glissé = viser puis relâcher pour lancer. Le sol ne déplace pas sur écran tactile. `?touch=1` les affiche sur ordinateur.
- **Version** : numéro unique dans `version.json`, appliqué à tous les fichiers chargés (`?v=…`) par une carte d'import générée. `npm run bump` avant chaque publication (`-- minor`, `-- major`, `-- sync`). Le jeu se recharge de lui-même si le serveur annonce une version plus récente. Détails dans `docs/ui-guide.md`.
- **Habillage** : `docs/ui-guide.md` liste ce qui est fait, ce qui reste (images, HUD du canvas) et les identifiants à conserver.

## Vision et retours de jeu

En 3v3, la jungle et le territoire adverse sont assombris hors de la vision de votre équipe. Héros, sbires, tours et noyau vivants partagent leur vision (rayons : 750, 370, 560 et 600 unités). Les zones redeviennent sombres quand les alliés s'éloignent ; les tours détruites ne fournissent plus de vision. Détruire une tour permet d'avancer avec les sbires pour révéler la suite de la ligne, sans révélation permanente. Le relief reste lisible sous le brouillard.

La vue principale, la mini-carte, les barres de vie, les effets et le ciblage utilisent la même règle. Les ennemis et monstres cachés ne sont pas sélectionnables au clic ni par l'assistance d'attaque. Un verrou se perd lorsque la cible sort de la vision partagée. Les timers des camps ne s'affichent que sous vision. Le duel conserve sa visibilité complète.

Chaque gain ponctuel d'or (dernier coup, présence, objectif, élimination, assistance et revente) produit un chiffre doré flottant, des pièces animées et un tintement local. Les gains rapprochés s'empilent. Le revenu passif fait seulement monter le compteur, sans son ni particules. Les impacts ont un éclat bref et les attaques du joueur un son discret ; un cercle turquoise confirme les ordres de déplacement. Le départ propose un compte à rebours, une invitation à acheter le starter, puis « En avant ! » et un signal sonore à l'ouverture des bases. Le réglage Son coupe ces sons ; la préférence de mouvement réduit supprime pièces, éclats, cercles et déplacement des chiffres. Les effets se figent pendant la pause.

## Bouton Attaque (ciblage automatique)

Le bouton (et la touche `A`) ne demande plus de cible : il choisit lui-même et **marche vers la cible** jusqu'à la portée, puis les autos partent.

- Cible conservée seulement si elle est valide et à portée d’attaque ; sinon, ennemi le plus proche dans le rayon d’assistance (700 px), sans priorité automatique aux héros.
- Boutons et raccourcis dédiés : **A** proximité, **C** Farm (sbires/monstres), **V** héros, **X** structures, **S** stop. Un filtre ne bascule jamais vers une autre catégorie si aucune cible ne correspond.
- Aucun ennemi dans le rayon : message « Aucun ennemi proche » et secousse du bouton, rien d'autre ne change.
- La marche utilise le même chemin que les bots (A* sur la grille, lissage) : elle contourne les obstacles et se recalcule toutes les 300 ms. Elle abandonne si la cible s'éloigne au-delà de `maxChase` ou si le héros reste bloqué 0,5 s.
- Un déplacement, le joystick, `S`, un nouveau verrou simple, un rappel ou la mort annulent l'approche (le verrou simple reste « sans poursuite », comme le cahier §2).
- **Exception assumée** à la règle « aucune poursuite automatique » : la poursuite n'existe que pour l'ordre explicite « Attaque » (commande `attack`), jamais pour un simple clic sur un ennemi.

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
- **Horloge** : 0:00 les six héros sont dans leur zone de départ ; **0:05** les sorties s'ouvrent (avant, les héros sont confinés) ; **0:15** première vague, puis toutes les 25 s (3 gnomes + 1 troll par ligne et par équipe, étalés de 450 ms).
- **Tours** : visent d'abord les sbires à portée, puis les héros. Un héros qui frappe un héros allié de la tour, tout en étant à portée de celle-ci, attire ses tirs pendant 2,5 s.
- **Mort** : délai interpolé linéairement (5 s jusqu'à 2 min, 11 s à 5 min, 20 s à 9 min et après), arrondi à la seconde. Le héros réapparaît dans sa base avec ses PV pleins. Compteurs éliminations / morts / assistances (assistance : un coup au héros tué dans les 10 s précédentes, sans le coup final).
- **Base** : soin de 8 % des PV max par seconde dans sa propre zone de départ.
- **Bots** : tiennent une ligne (Jennie alterne), suivent leur sbire le plus avancé, évitent de se tenir sous une tour sans sbire allié à sa portée, se replient à bas PV (seuil propre à chaque bot, tiré de la graine), se soignent et reviennent à pied. Ils utilisent exactement les mêmes commandes que le joueur.
- **Interface minimale** : chrono, éliminations et tours, PV du joueur, compte à rebours de réapparition, minimap (un ennemi n'y apparaît que s'il est vu par un allié). Le HUD complet, la boutique et le tableau des scores sont le lot 4.

## Règles du lot 3 (cahier §1 et §2)

**Progression.** Niveaux 1 à 9 (seuils d'XP dans `match.json`). Niveau 1 : auto rang 1. Niveaux 2, 4, 5, 7 et 8 : un point à dépenser, en auto ou en skill, jusqu'au rang 3 chacun (cinq points = rang 3 partout). Niveaux 3, 6 et 9 : l'ultime prend le rang 1, 2 puis 3 **automatiquement, sans dépenser de point**, même si des points restent en attente (le message de montée de niveau l'indique : « ultime rang 1 débloqué · 1 point à dépenser »). Avant le niveau 3 l'ultime est verrouillé et ne peut pas être lancé. Les points se gardent dans le HUD. Chaque niveau augmente PV, Attaque et Défense ; le rang d'auto ajoute +15 % puis +30 % de dégâts. L'XP est au prorata **du temps passé et des monstres tués** : 2 XP par seconde pour tout héros vivant, plus les kills (gnome 16, troll 30, petite unité de camp 30, grande 70, Cerbère 300, héros 80 + 25 par niveau), partagés entre les héros de l'équipe à moins de 1000 px. Seuils d'XP (`progression.levels`) : 0, 110, 410, 670, 920, 1180, 1470, 1780, 2130. Mesuré avec des bots : niveau 2 vers 0:45, **niveau 3 (ultime) vers 2:00**, niveau 5 vers 4:00, niveau 9 vers 9:00.

**Compétences** (une recharge propre à chacune, les dégâts utilisent l'Attaque selon un coefficient ; les instants viennent des packs d'animation) :

| Héros | Skill (rang 1 / 2 / 3) | Ultime (niveau 3 / 6 / 9) |
| --- | --- | --- |
| Yeji | **Coupe éclair** : dash de 340 / 380 / 420 px, la coupe frappe à 185 ms, **traverse** et touche chaque ennemi une fois. Vers la cible verrouillée si elle est à portée, sinon vers la visée. Recharge 5 s. | **Cercle des lames** : zone de rayon 200 qui **suit Yeji** pendant 4 s et **ralentit de 30 / 40 / 50 %**. Aucun dégât. Pose à 160 ms. Recharge 45 s. |
| Sweetie | **Ruée** : dash de 260 / 290 / 320 px sur 340 ms (courbe fournie), **s'arrête au contact** de la première cible, qu'elle seule touche. Recharge 5 s. | **Bouclier** : absorbe 150 / 250 / 350 pendant 4 s, actif à 220 ms, retiré à 4 220 ms après le lancer. Absorbe **après la Défense, avant les PV**. Sweetie seule. Recharge 45 s. |
| Jennie | **Triple bouquet** : trois bouquets à −15°, 0° et +15° (sens horaire à l'écran) à 235 ms, en ligne droite, chacun touche le premier ennemi rencontré. Portée 600 / 640 / 680. Recharge 5 s. | **Couronne de ronces** : anneau de rayon 230 posé à 180 ms sur place (il ne suit pas Jennie), visible puis armé après 0,6 s : dégâts d'armement, puis dégâts périodiques pendant 3 s. Recharge 45 s. |

**Recharges** (réglage de départ) : **5 s pour tous les skills, 45 s pour tous les ultimes**, à tous les rangs. Un lancer occupe le héros jusqu'à la fin de son animation (un ordre de déplacement est refusé). Les ralentissements ne s'empilent pas : le plus fort s'applique, avec un plancher à 40 % de la vitesse.

**Monstres des lignes.** Chaque vague compte **trois gnomes et un troll** par ligne et par équipe (le sbire à distance du lot 2 est retiré : aucune planche ne le couvrait). Le troll est plus gros, plus lent, plus résistant et rapporte plus d'XP.

**Jungle.** De **chaque côté**, un camp de fleurs carnivores et un camp de dragons : une grande unité au centre et deux petites sur les côtés (positions et échelles du pack). Les camps de l'autre côté sont le miroir exact (mêmes distances d'accès pour les deux équipes). Ils apparaissent à 0:15, sont passifs tant qu'on ne les frappe pas, puis **tout le camp riposte ensemble**. Ils abandonnent la poursuite hors de leur laisse, reviennent se soigner, et réapparaissent 60 s après avoir été nettoyés.

**Cerbère (boss).** Annonce à **3:15**, apparition à **3:30** au centre exact de la carte. Mort à 4:10 → retour à **7:40** (3:30 après sa mort ; nouvelle annonce 15 s avant). Deux attaques : une **morsure** (impact à 320 ms) et un **souffle de braises** en cône de 35° sur 320 px (départ à 510 ms, toutes les 7 s), qui touche aussi les héros et sbires alentour. Calibré pour qu'un duo (Yeji + Jennie niveau 4) le batte en moins de 40 s sans perdre un héros.

**Durée de la partie.** Limite de **10 minutes** (`timeLimitMs` dans `match.json`) : à 10:00 la partie s'arrête et l'équipe qui a le plus entamé les structures adverses gagne, puis les éliminations, sinon égalité. Contre un héros inactif, trois bots détruisent le noyau en 3 à 7 minutes ; deux équipes de bots identiques ne se départagent pas toutes seules et finissent à la limite.

**Vague renforcée.** L'équipe qui porte le dernier coup gagne deux brutes en plus dans une vague. Le joueur crédité choisit **haut ou bas** pendant 10 secondes via l'invite du HUD (boutons ou touches `1` / `2`) ; sans choix, ligne par défaut (haut, réglable dans `match.json`). Le bonus est consommé par la prochaine vague de cette équipe sur cette ligne, une seule fois.

**Bots (IA renforcée).** Un bot ne reste plus à attendre au milieu : hors combat il avance jusqu'au point sûr le plus avancé de sa ligne, rejoint un allié engagé (priorité au joueur humain, portée d'aide 2 600 px contre 1 500 pour un bot), défend quand des ennemis approchent de ses structures, pousse **collectivement** quand l'équipe a l'avantage numérique (30 s d'élan) et ose plonger sous une tour quand deux alliés en forme sont proches. Ils engagent plus largement et utilisent leurs skills plus librement. Mesure : inactivité hors base d'environ 45 % avant, **3 à 15 %** maintenant ; trois bots battent un héros inactif en 200 à 390 s. Compétences : Dépensent leurs points, lancent skill et ultime selon des règles simples (dash pour rejoindre un héros, éventail à portée, ultime quand des ennemis sont dans la zone, bouclier quand ils sont blessés). Jennie, sans ligne attitrée, fait la jungle quand aucune ligne n'est menacée. Jennie et Sweetie (ligne du bas) prennent le boss en duo quand les deux sont en forme. Un bot blessé et au calme remonte se soigner.

## Règles du lot 4 (cahier §3 et §4)

**Or.** Départ : 300 (couvre n'importe quel starter). L'or vient du **dernier coup** (gnome 20, troll 45, petite unité de camp 35, grande 70, Cerbère 250 ; rien si un sbire ou une tour porte le coup final), des éliminations (200) et des assistances (80). Tout est dans `data/match.json` (`economy`, champ `gold` des unités).

**Douze objets** (`data/items.json`, issu du pack fourni) : trois familles, un starter à 250 et trois gros objets de 850 à 1050 par famille. Trois emplacements, un exemplaire par objet, revente à **70 %** (arrondie vers le bas, affichée avant confirmation).

| Famille | Starter | Gros objets |
| --- | --- | --- |
| Physique | **Lame courte** : +8 dégâts bruts aux autos | **Dague d'ouverture** : première auto après 5 s hors combat +24 · **Gants de duel** : chaque 3e auto consécutive sur la même cible +30 · **Marteau de siège** : +25 % d'auto contre les tours |
| Tank | **Ceinture** : +90 PV max | **Cuirasse** : +18 Défense · **Talisman** : sous 30 % de PV après un coup, bouclier de 100 pendant 3 s, recharge 45 s · **Armure de mêlée** : après des dégâts de deux héros ennemis distincts en 4 s, +20 Défense pendant 4 s, recharge 16 s |
| Magique | **Grimoire** : +12 sur le premier impact du skill par cible et par lancer | **Catalyseur** : recharge du skill −15 % · **Relique** : +15 % sur la valeur principale de l'ultime (ralentissement, bouclier ou dégâts d'armement) · **Sceau** : le skill qui touche un héros retire 20 % de la recharge restante, une fois par lancer |

Les bonus de recharge ne descendent jamais sous `minSkillCooldownMs` (1000 ms).

**Règles d'achat.** Le **premier starter** s'achète n'importe où (ligne ou jungle) et consomme cette possibilité, même acheté à la base ou revendu ensuite. Tout autre achat, et toute vente : héros vivant dans sa zone de départ (« zone de boutique »). Blocages affichés : « Retour à la base », « Or insuffisant », « Inventaire plein », « Déjà équipé », « Héros éliminé ». Un achat est atomique (or et inventaire changent ensemble) ; un double appui ne débite qu'une fois, et l'interface verrouille le bouton 0,7 s pour qu'un second appui ne revende pas l'objet aussitôt.

**Boutique (interface).** Trois onglets Physique, Tank, Magique ; starters en tête de liste ; fiche avec effet, or disponible, Acheter ou Revendre et aperçu des trois emplacements. Hors base le catalogue reste consultable. Le match **continue** pendant que la boutique ou les scores sont ouverts ; leurs panneaux consomment les appuis ; fermeture d'un geste (✕, fond, `P`, `Échap`). Sons courts à chaque action confirmée ou refusée (réglage dans la pause).

**Rappel.** Danse sur place avec un cercle et une jauge visibles de tous, puis retour à la base, où le héros se soigne. Durée **3,6 s** : celle des animations fournies (le cahier disait 4 s). Interrompu par un déplacement ou le joystick, une attaque lancée (verrouiller un ennemi), une capacité ou un ultime, ou **tout dégât, même absorbé par un bouclier**. Les autos sont suspendues pendant la danse : un verrou resté actif ne l'annule pas par inadvertance. Achats, points de compétence et `S` ne l'interrompent pas.

**Scores.** Maintenir `Tab`, bouton « Scores » ou toucher le score en haut. Deux blocs de trois lignes à l'ordre stable (votre équipe d'abord) : portrait, nom, niveau, éliminations / morts / assistances, trois emplacements d'objets, en-tête avec éliminations et tours détruites. Votre ligne est surlignée, les héros morts grisés avec leur délai. L'écran de fin reprend les six lignes figées.

**Bots.** Ils achètent leur starter à 0:00, puis des gros objets selon leur rôle (Yeji physique, Sweetie tank, Jennie magique), revendent le starter quand l'inventaire est plein, et se **rappellent** pour aller à la boutique ou quand ils sont blessés et loin de la base, s'ils sont à l'abri.

## Revenus du lot 6 : or du temps, de présence et d'objectif

Avant ce lot, l'or ne venait que du dernier coup, des éliminations et des assistances : un héros gagnait en moyenne **1 280 or sur 10 minutes** (30 or la première minute), le délai médian entre deux gains était de **21 s** et un gros objet à 850-1 050 n'arrivait qu'à **7:30**. La boutique ne servait presque à rien. Quatre revenus s'ajoutent (tout est dans `data/match.json`, bloc `economy`) :

| Revenu | Valeur | Règle |
| --- | --- | --- |
| Or du temps | **2 or/s** (`passivePerSec`) | Tout héros vivant, versé en paliers entiers ; le compteur monte sans afficher « +2 » à chaque seconde. |
| Or de présence | **50 %** de l'or du sbire (`laneShareRatio`), héros à moins de **800 px** (`laneShareRadius`) | Quand un sbire ou un monstre meurt sans dernier coup de héros (sbires alliés, tour). Si un héros porte le coup, il garde l'or complet et personne d'autre ne reçoit de part. |
| Tour détruite | **150** (extérieure) / **200** (intérieure) pour **chaque héros** de l'équipe (`towerGold`) | Vivants ou non. |
| Cerbère | **200** par héros de l'équipe (`bossTeamGold`) | En plus des 250 du dernier coup. |

Rythme : première vague et camps de jungle à **0:15** au lieu de 0:30 (`waves.firstMs`, `jungle.startMs`).

Mesure avec six bots (quatre graines, 10 minutes) : or par héros **1 280 → environ 3 170**, soit ~320 or par minute ; délai médian entre gains **21 s → 4 s** ; premier gros objet **7:30 → 3:40**, deuxième **jamais → 6:30**, troisième vers **8:15**. Les niveaux restent dans la fourchette voulue (niveau 4-5 à 4:00, 8-9 à 8:00).

## Limites connues

- **Économie** : valeurs de départ, calées avec des bots (voir « Revenus du lot 6 »). Le rythme visé est atteint : premier gros objet vers 3:40, deuxième vers 6:30, troisième vers 8:15 pour la plupart des bots. À réévaluer avec de vrais joueurs, qui farment mieux que les bots.
- **Rappel de 3,6 s** et non 4 s (durée des animations) ; les effets d'objets n'ont pas d'icône sur le héros (pas d'indicateur de bouclier de Talisman ou de bonus d'Armure, hors barre de PV).
- **Sbires** : ils suivent la ligne en ligne droite, sans collision avec les obstacles ni avec les héros, et s'écartent seulement les uns des autres.
- **Équilibrage** : valeurs de départ (structures : tour extérieure 1300 PV, intérieure 1600, noyau 2000). Deux équipes de bots identiques s'annulent (les vagues se rencontrent au milieu, rien ne bascule) ; la partie se décide dès qu'un humain ou un déséquilibre intervient. Une équipe de trois bots détruit le noyau d'un héros inactif en 3 à 7 minutes (IA renforcée).
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
5. À 0:15 les camps apparaissent ; à 3:15 une annonce, à 3:30 le Cerbère au centre : approche-toi de lui, il alterne morsure et souffle en cône. Tue-le avec un autre héros : l'invite « Vague renforcée » s'ouvre, choisis `1` ou `2`.
6. Monte de niveau (`?level=2`) : le bouton « + » apparaît sur Attaque et sur la compétence ; l'ultime se débloque au niveau 3.

## Vérifier le lot 2

À la main, avec `?speed=4` pour aller plus vite :

1. À 0:01, tenter de sortir de la zone : le héros reste dedans jusqu'à **0:05**.
2. À **0:15** les premières vagues partent ; elles se rencontrent près du centre de chaque ligne vers 0:45.
3. Verrouiller une tour intérieure : le clic se transforme en déplacement tant que l'extérieure vit (cristal creux, libellé « protégé »).
4. Se placer sous une tour ennemie avec un sbire allié près d'elle : la tour tire sur le sbire. Frapper un héros ennemi à portée de sa tour : elle se retourne contre vous.
5. Mourir : compte à rebours au centre de l'écran, réapparition dans la base en PV pleins, compteur de morts incrémenté.
6. Détruire deux tours d'une même ligne puis le noyau : écran Victoire.

En automatique : `npm test` (171 tests) couvre le tableau de réapparition, la sortie à 0:05, les vagues à 0:15, l'invulnérabilité en cascade, la fin de partie, la priorité des tours, l'assistance, le soin en base et les bots (destruction du noyau d'un héros inactif, repli puis retour en lane). Le lot 3 est couvert par `tests/lot3.test.js` (niveaux et rangs, partage d'XP, dash qui traverse ou qui s'arrête, éventail, bouclier et son expiration à 4 220 ms, zones et ralentissements, camps, laisse, boss à 3:15 / 3:30 / 7:40, duo contre le boss, vague renforcée et choix par défaut) et `tests/animator.test.js` (images, directions, échelles). `tests/ui.test.js` couvre la boutique et le profil, la cohérence des versions et de la carte d'import, le joystick, les boutons d'action et la commande `steer`. `tests/lot4.test.js` couvre l'or, les règles d'achat et de vente, les douze effets, le rappel et ses interruptions, les achats des bots et les données du tableau des scores. `tests/lot5.test.js` couvre la commande d'attaque (approche, contournement d'obstacle, annulations), le choix automatique de cible, le verrouillage de l'ultime avant le niveau 3, l'activité des bots (assistance, défense, poussée, rassemblement contre le boss) et la logique du lobby (minuteur, validation automatique, choix, bots). `tests/balance.test.js` couvre les recharges, l'XP du temps et des kills, la limite de 10 minutes, les camps symétriques, le souffle du Cerbère et la synchronisation données ↔ animations (impact à la 4e image, durées, fichiers présents).

## Hors périmètre

Salle privée en ligne à six places, serveur qui arbitre les actions, les achats, les dégâts, les scores et les minuteurs (lot 5).

## Question ouverte

Voir `docs/kits-heros.md` : les kits y sont décrits tels que construits. Restent à arbitrer l'équilibrage (recharges, dégâts, rayon des zones) et le comportement des bots autour du boss.
