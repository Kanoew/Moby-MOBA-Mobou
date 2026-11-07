# Kits des trois premiers compagnons

Kits implémentés au lot 3, tels qu'ils sont dans `data/heroes.json`. Les chiffres sont des **valeurs de départ** à régler après des parties jouées. Recharges fixées à la demande de Jordan : **5 s pour les skills, 45 s pour les ultimes**, à tous les rangs. Les noms viennent des packs d'animation fournis : Coupe éclair, Cercle des lames (Yeji), Ruée, Bouclier (Sweetie), Triple bouquet, Couronne de ronces (Jennie).

**Décisions prises avec les animations** : la zone de Yeji **suit Yeji** (le pack le prévoit) au lieu d'être posée à la visée ; le bouclier de Sweetie ne protège que **Sweetie** ; les ronces de Jennie sont posées sur place, visibles puis armées, avec des dégâts, alors que la zone de Yeji ralentit sans dégâts. Jennie reçoit en plus un skill, le Triple bouquet (éventail à −15°, 0°, +15°).

## Écarts avec le cahier des charges (§2, « Premiers compagnons »)

| Cahier | Maintenant |
| --- | --- |
| Mariée gothique · bouquet, ronces | Inchangée (Jennie) |
| Épéiste · pas d'attaque, **grande taille en cône** | Sweetie · pas d'attaque, **bouclier** (le cône disparaît) |
| Protecteur · bouclier sur un allié, onde de recul | Remplacé par **Yeji**, duelliste rapide. Plus de Protecteur dans les trois premiers. |

Composition de test : Jennie (distance), Sweetie et Yeji (deux bruisers, mi-tank mi-DPS), tous trois déjà dotés d'animations d'auto.

## Identité

- **Yeji** : rapide, mobile, contrôle. Elle entre, enchaîne, ralentit la zone.
- **Sweetie** : lourde, encaisse, échange. Elle entre, tient, protège sa propre vie.
- Même verbe pour le skill (un dash avant), mais deux sensations : celui de Yeji **traverse**, celui de Sweetie **s'arrête sur la cible**.

## Yeji · Katana

| | Rang 1 / 2 / 3 | Règle |
| --- | --- | --- |
| Stats | PV 700 · Attaque 60 · Défense 30 · vitesse 300 | Plus rapide que Jennie (290). |
| Auto | Coup de katana | Impact à 400 ms (image 2). Cadence à resserrer quand l'animation sera plus nerveuse (1030 ms aujourd'hui). |
| **Skill · Coupe éclair** (ex-Fente) | portée 340 / 380 / 420 · recharge 5 s · dégâts 50 / 80 / 110 | Dash vers la cible verrouillée si elle est dans la portée, sinon vers la direction visée. **Traverse les ennemis** (un seul coup chacun). S'arrête aux obstacles. La prochaine auto peut partir tout de suite. |
| **Ult · Cercle des lames** (niv. 3 / 6 / 9) | rayon 200 · durée 4 s · ralentissement 30 / 40 / 50 % · recharge 45 s | Zone qui suit Yeji. Aucun dégât. Un seul ralentissement actif par unité : le plus fort gagne, pas d'empilement. Plancher de vitesse configurable. |

## Sweetie · Épée

| | Rang 1 / 2 / 3 | Règle |
| --- | --- | --- |
| Stats | PV 820 · Attaque 55 · Défense 45 · vitesse 280 | Plus lente et plus solide que Yeji. |
| Auto | Coup d'épée | Dégâts à 200 ms (image 3). L'arrêt sur impact de 45 ms proposé par le pack n'est pas encore implémenté. |
| **Skill · Ruée** (ex-Pas d'attaque) | portée 260 / 290 / 320 · recharge 5 s · dégâts 70 / 105 / 140 | Dash vers la cible ou la direction visée. **S'arrête au contact** de la première cible touchée (elle seule est touchée). Plus court mais plus fort que la Coupe éclair. |
| **Ult · Bouclier** (niv. 3 / 6 / 9) | absorbe 150 / 250 / 350 · durée 4 s · recharge 45 s | Le bouclier absorbe **après** la Défense et **avant** les PV. Disparaît à la fin de la durée. |

## Ce que la simulation fait

- **Statuts** : ralentissement (valeur, source, fin) et bouclier (montant, fin). Ils vivent sur l'unité, lus par le HUD.
- **Dash** : déplacement forcé à vitesse fixe, collisions conservées, suspend les autos pendant le dash, ne change pas le verrou.
- **Zone** : entité avec délai d'armement visible, durée et rayon, qui applique le statut chaque pas.
- **Dégâts de dash et de zone** : même formule de Défense unique que les autos.
- Les animations fournies pilotent les instants (frappe à 185 ms, bouclier à 220 ms, éventail à 235 ms, anneau à 180 ms) ; les effets (orbite, zones, bouclier, trait de coupe) sont dessinés dans une couche séparée, sans toucher aux règles.

## Jennie (ajouté au lot 3)

| | Rang 1 / 2 / 3 | Règle |
| --- | --- | --- |
| Stats | PV 520 · Attaque 48 · Défense 15 · vitesse 290 | Auto à distance (bouquet), portée 520. |
| **Skill · Triple bouquet** | portée 600 / 640 / 680 · recharge 5 s · dégâts par bouquet 39 / 49 / 59 au niveau 1 | Trois bouquets à −15°, 0°, +15° à 235 ms, en ligne droite, chacun touche le premier ennemi rencontré. |
| **Ult · Couronne de ronces** (niv. 3 / 6 / 9) | rayon 230 · armement 0,6 s · durée 3 s · recharge 45 s | Anneau posé à 180 ms sur sa position. Dégâts à l'armement, puis périodiques. |

## Questions résolues

1. Le bouclier de Sweetie protège-t-il aussi les alliés ? **Non, elle seule.**
2. La zone de Yeji est-elle posée à la visée ou centrée sur elle ? **Centrée sur elle et mobile**, comme le prévoit le pack.
3. Ronces de Jennie et zone de Yeji se ressemblent-elles ? Différenciées : **ronces = dégâts après délai, zone = contrôle sans dégâts.**
