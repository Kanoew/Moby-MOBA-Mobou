// Entrées souris et tactile → commandes. Un clic sur un ennemi le verrouille, sinon déplacement au sol.
import { isTargetable } from '../sim/world.js';

/** Unité ennemie ciblable sous le point (tolérance un peu large pour le tactile). Héros > sbires > structures. */
export function pickEnemyAt(world, localHero, x, y, padding = 18) {
  let best = null;
  let bestTier = 9;
  let bestD = Infinity;
  for (const u of world.units) {
    if (!isTargetable(world, localHero, u)) continue;
    let hit;
    let d;
    if (u.kind === 'hero') {
      // Boîte approximative du sprite : large de 2 rayons + marge, haute d'environ 150 px au-dessus des pieds.
      hit = Math.abs(x - u.x) <= u.radius + padding && y >= u.y - 150 - padding && y <= u.y + u.radius + padding;
      d = Math.hypot(x - u.x, y - (u.y - 60));
    } else if (u.kind === 'minion' || u.kind === 'monster') {
      // Boîte du sprite : hauteur tirée de l'échelle d'affichage, largeur d'environ un tiers.
      const h = u.def.sprite ? 232 * u.def.sprite.scale : u.radius * 2.6;
      hit = Math.abs(x - u.x) <= Math.max(u.radius, h * 0.3) + padding * 0.6 && y >= u.y - h - padding * 0.6 && y <= u.y + 10 + padding * 0.6;
      d = Math.hypot(x - u.x, y - (u.y - h * 0.4));
    } else {
      // Tour / noyau : socle et fût.
      hit = Math.abs(x - u.x) <= u.radius + padding * 0.5 && y >= u.y - 170 && y <= u.y + u.radius * 0.5 + padding;
      d = Math.hypot(x - u.x, y - u.y);
    }
    if (!hit) continue;
    const tier = u.kind === 'hero' ? 0 : u.kind === 'minion' || u.kind === 'monster' ? 1 : 2;
    if (tier < bestTier || (tier === bestTier && d < bestD)) {
      best = u;
      bestTier = tier;
      bestD = d;
    }
  }
  return best;
}

export function commandForPoint(world, localHero, x, y) {
  const enemy = pickEnemyAt(world, localHero, x, y);
  if (enemy) return { type: 'target', targetId: enemy.id };
  return { type: 'move', x, y };
}

export function bindPointer(canvas, getWorldPoint, onCommandAt) {
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    const p = getWorldPoint(e.clientX, e.clientY);
    onCommandAt(p.x, p.y, e);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
