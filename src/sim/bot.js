// Bot : n'utilise que issueCommand, exactement comme le joueur.
import { edgeDistance, getHero, isVisibleTo, issueCommand } from './world.js';

const THINK_MS = 150;

export function updateBot(world, hero, dtMs) {
  if (hero.dead || world.over) return;
  hero.thinkMs -= dtMs;
  if (hero.thinkMs > 0) return;
  hero.thinkMs = THINK_MS;

  let best = null;
  let bestD = Infinity;
  for (const e of world.heroes) {
    if (e.dead || e.team === hero.team || !isVisibleTo(e, hero.team)) continue;
    const d = edgeDistance(hero, e);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (!best) return;

  if (hero.targetId !== best.id) issueCommand(world, hero.id, { type: 'target', targetId: best.id });

  const range = hero.def.auto.range;
  const desired = range * 0.85;
  if (bestD > desired) {
    // Se place à portée en marchant vers la cible (ordre de déplacement classique).
    const t = getHero(world, best.id);
    const dx = t.x - hero.x;
    const dy = t.y - hero.y;
    const len = Math.hypot(dx, dy) || 1;
    const stopAt = hero.radius + t.radius + desired;
    issueCommand(world, hero.id, { type: 'move', x: t.x - (dx / len) * stopAt, y: t.y - (dy / len) * stopAt });
  } else if (hero.moveTarget) {
    issueCommand(world, hero.id, { type: 'stop' });
  }
}
