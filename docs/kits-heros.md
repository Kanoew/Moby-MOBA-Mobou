# Kits des trois premiers compagnons

Brouillon de conception pour le lot 3 (rangs 1 à 9, compétences). Les chiffres sont des **valeurs de départ** à régler dans `data/heroes.json`, pas des décisions.

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
| **Skill · Fente** | portée 340 / 380 / 420 · recharge 8 / 7 / 6 s · dégâts 50 / 80 / 110 | Dash vers la cible verrouillée si elle est dans la portée, sinon vers la direction visée. **Traverse les ennemis** (un seul coup chacun). S'arrête aux obstacles. La prochaine auto peut partir tout de suite. |
| **Ult · Zone d'entrave** (niv. 3 / 6 / 9) | rayon 220 · délai visible 0,6 s · durée 4 s · ralentissement 30 / 40 / 50 % · recharge 70 / 60 / 50 s | Zone posée à la visée (portée 450). Aucun dégât. Un seul ralentissement actif par unité : le plus fort gagne, pas d'empilement. Plancher de vitesse configurable. |

## Sweetie · Épée

| | Rang 1 / 2 / 3 | Règle |
| --- | --- | --- |
| Stats | PV 820 · Attaque 55 · Défense 45 · vitesse 280 | Plus lente et plus solide que Yeji. |
| Auto | Coup d'épée | Dégâts à 200 ms (image 3), arrêt sur impact de 45 ms (pack d'attaque). |
| **Skill · Pas d'attaque** | portée 260 / 290 / 320 · recharge 9 / 8 / 7 s · dégâts 70 / 105 / 140 | Dash vers la cible ou la direction visée. **S'arrête au contact** de la première cible touchée, avec arrêt sur impact. Plus court mais plus fort que Fente. |
| **Ult · Bouclier** (niv. 3 / 6 / 9) | absorbe 150 / 250 / 350 · durée 4 s · recharge 60 / 50 / 40 s | Le bouclier absorbe **après** la Défense et **avant** les PV. Disparaît à la fin de la durée. |

## Ce que ça demande à la simulation

- **Statuts** : ralentissement (valeur, source, fin) et bouclier (montant, fin). Ils vivent sur l'unité, lus par le HUD.
- **Dash** : déplacement forcé à vitesse fixe, collisions conservées, suspend les autos pendant le dash, ne change pas le verrou.
- **Zone** : entité avec délai d'armement visible, durée et rayon, qui applique le statut chaque pas.
- **Dégâts de dash et de zone** : même formule de Défense unique que les autos.
- Aucune animation de skill n'existe encore : premier jet avec la ligne de course existante, une traînée et des cercles dessinés en couche d'effets séparée. Les animations arrivent plus tard sans toucher aux règles (l'instant d'impact vient des données).

## Questions ouvertes

1. Le bouclier de Sweetie protège-t-il **elle seule**, ou aussi les alliés proches ? Par défaut : elle seule.
2. La zone de Yeji est posée à la visée. Autre piste : centrée sur elle et mobile avec elle. Par défaut : à la visée, comme les ronces de Jennie.
3. Les ronces de Jennie (ultime) et la zone de Yeji se ressemblent. À différencier : ronces = dégâts après délai, zone = contrôle sans dégâts.
