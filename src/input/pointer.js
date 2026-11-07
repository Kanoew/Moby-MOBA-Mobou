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

/**
 * Distingue un appui (verrouiller un ennemi) d'un glissé (déplacer la caméra) pour un doigt posé sur le canvas.
 * Pur : reçoit des positions écran en pixels CSS. Le glissé commence au-delà de `slopPx` ; il rend ensuite les
 * déplacements incrémentaux. Un seul doigt est suivi à la fois ; les autres sont ignorés jusqu'à son relâchement.
 */
export function createTapDrag(slopPx = 10) {
  let id = null;
  let start = null;
  let last = null;
  let dragging = false;
  return {
    down(pointerId, x, y) {
      if (id !== null) return false;
      id = pointerId;
      start = last = { x, y };
      dragging = false;
      return true;
    },
    /** Renvoie { dx, dy, first } tant que le doigt glisse (first = le premier pas du glissé), sinon null. */
    move(pointerId, x, y) {
      if (pointerId !== id) return null;
      if (!dragging && Math.hypot(x - start.x, y - start.y) < slopPx) return null;
      const first = !dragging;
      dragging = true;
      // Au premier pas on rattrape tout le chemin déjà parcouru depuis la pose du doigt : pas de saut perceptible.
      const from = first ? start : last;
      const d = { dx: x - from.x, dy: y - from.y, first };
      last = { x, y };
      return d;
    },
    /** Fin du suivi : 'tap' (pas de glissé), 'drag', ou null si ce doigt n'était pas suivi. */
    up(pointerId) {
      if (pointerId !== id) return null;
      const result = dragging ? 'drag' : 'tap';
      id = null;
      start = last = null;
      dragging = false;
      return result;
    },
    active: () => id !== null,
    isDragging: () => dragging,
  };
}

/**
 * Souris et tactile sur le canvas.
 *  - Souris : bouton gauche = commande immédiate (inchangé) ; bouton du milieu maintenu = glissé de caméra.
 *  - Tactile : un appui court donne la commande à l'appui relâché (verrouiller un ennemi) ; un glissé déplace la caméra.
 *    Une zone du HUD dessiné sur le canvas (`isHudHit`) réagit tout de suite, comme avant.
 * `opts.onPan(dxCssPx, dyCssPx)` et `opts.onPanEnd()` reçoivent le glissé ; sans eux, le comportement d'origine est conservé.
 */
export function bindPointer(canvas, getWorldPoint, onCommandAt, opts = {}) {
  const { onPan, onPanEnd, isHudHit, slopPx = 10 } = opts;
  const tracker = createTapDrag(slopPx);
  let middleId = null;
  let middleLast = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (onPan && e.button === 1) {
      e.preventDefault();
      middleId = e.pointerId;
      middleLast = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* sans effet */ }
      return;
    }
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    const deferred = onPan && e.pointerType === 'touch' && !(isHudHit && isHudHit(e));
    if (deferred) {
      if (tracker.down(e.pointerId, e.clientX, e.clientY)) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* sans effet */ }
      }
      return;
    }
    const p = getWorldPoint(e.clientX, e.clientY);
    onCommandAt(p.x, p.y, e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === middleId) {
      onPan(e.clientX - middleLast.x, e.clientY - middleLast.y);
      middleLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const d = tracker.move(e.pointerId, e.clientX, e.clientY);
    if (d) onPan(d.dx, d.dy);
  });
  const end = (e, cancelled) => {
    if (e.pointerId === middleId) {
      middleId = null;
      if (onPanEnd) onPanEnd();
      return;
    }
    const r = tracker.up(e.pointerId);
    if (r === 'drag') {
      if (onPanEnd) onPanEnd();
    } else if (r === 'tap' && !cancelled) {
      const p = getWorldPoint(e.clientX, e.clientY);
      onCommandAt(p.x, p.y, e);
    }
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
