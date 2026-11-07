// Entrées souris et tactile → commandes. Un clic sur un ennemi le verrouille, sinon déplacement au sol.
import { isVisibleTo } from '../sim/world.js';

/** Ennemi sous le point (tolérance un peu large pour le tactile). */
export function pickEnemyAt(world, localHero, x, y, padding = 18) {
  let best = null;
  let bestD = Infinity;
  for (const h of world.heroes) {
    if (h.dead || h.team === localHero.team || !isVisibleTo(h, localHero.team)) continue;
    // Boîte approximative du sprite : large de 2 rayons + marge, haute d'environ 150 px au-dessus des pieds.
    const dx = Math.abs(x - h.x);
    const inside = dx <= h.radius + padding && y >= h.y - 150 - padding && y <= h.y + h.radius + padding;
    if (!inside) continue;
    const d = Math.hypot(x - h.x, y - (h.y - 60));
    if (d < bestD) {
      best = h;
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
    onCommandAt(p.x, p.y);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
