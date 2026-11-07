// Cœur de simulation : aucune dépendance au DOM, au canvas ni au temps réel.
// Entrées = commandes (issueCommand). Sortie = état + événements. Le rendu ne fait que lire.

import { findPath } from './path.js';

export const TEAM_ALLY = 'ally';
export const TEAM_ENEMY = 'enemy';

const STUCK_LIMIT_MS = 250;

/** Durée totale et instant d'impact d'une attaque, dérivés des durées d'images. */
export function attackTiming(auto) {
  const d = auto.frameDurationsMs;
  const durationMs = d.reduce((a, b) => a + b, 0);
  const hitMs = d.slice(0, auto.hitFrame).reduce((a, b) => a + b, 0);
  return { durationMs, hitMs };
}

/** Une seule Défense : dégâts = attaque × 100 / (100 + défense). */
export function mitigate(raw, def) {
  return Math.max(1, Math.round((raw * 100) / (100 + def)));
}

export function createWorld({ map, heroDefs, roster }) {
  const world = {
    time: 0,
    map,
    heroDefs,
    heroes: [],
    projectiles: [],
    events: [],
    over: null,
    nextProjectileId: 1,
    onEvent: null,
  };
  for (const r of roster) {
    const def = heroDefs[r.hero];
    const spawn = map.spawns[r.team];
    world.heroes.push({
      id: r.id,
      key: r.hero,
      team: r.team,
      controller: r.controller || 'player',
      def,
      timing: attackTiming(def.auto),
      x: spawn.x,
      y: spawn.y,
      radius: def.stats.radius,
      hp: def.stats.hp,
      maxHp: def.stats.hp,
      atk: def.stats.atk,
      def_: def.stats.def,
      speed: def.stats.speed,
      facing: { x: r.team === TEAM_ALLY ? 1 : -1, y: 0 },
      targetId: null,
      moveTarget: null,
      path: [],
      swing: null,
      nextAttackAt: 0,
      invisible: false,
      dead: false,
      stuckMs: 0,
      thinkMs: 0,
    });
  }
  return world;
}

export function getHero(world, id) {
  return world.heroes.find((h) => h.id === id) || null;
}

export function isVisibleTo(hero, team) {
  return hero.team === team || !hero.invisible;
}

/** Distance entre les bords des deux cercles (portée mesurée de bord à bord). */
export function edgeDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.radius - b.radius;
}

function emit(world, ev) {
  ev.t = world.time;
  world.events.push(ev);
  if (world.onEvent) world.onEvent(ev);
}

function face(hero, tx, ty) {
  const dx = tx - hero.x;
  const dy = ty - hero.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.001) hero.facing = { x: dx / len, y: dy / len };
}

function cancelSwing(world, hero, reason) {
  if (!hero.swing) return;
  // Annuler avant l'impact ne consomme pas la cadence.
  if (!hero.swing.hitDone) hero.nextAttackAt = hero.swing.prevNextAttackAt;
  emit(world, { type: 'swing_cancel', heroId: hero.id, reason });
  hero.swing = null;
}

/* ------------------------------------------------------------------ */
/* Commandes : mêmes entrées pour le joueur et pour les bots           */
/* ------------------------------------------------------------------ */

export function issueCommand(world, heroId, cmd) {
  const hero = getHero(world, heroId);
  if (!hero || hero.dead || world.over) return false;

  switch (cmd.type) {
    case 'move': {
      const x = Math.min(world.map.width - hero.radius, Math.max(hero.radius, cmd.x));
      const y = Math.min(world.map.height - hero.radius, Math.max(hero.radius, cmd.y));
      hero.path = findPath(world.map, hero.radius, { x: hero.x, y: hero.y }, { x, y });
      hero.moveTarget = { ...hero.path[hero.path.length - 1] };
      hero.stuckMs = 0;
      cancelSwing(world, hero, 'move');
      return true;
    }
    case 'stop':
      hero.moveTarget = null;
      hero.path = [];
      return true;
    case 'target': {
      const t = getHero(world, cmd.targetId);
      if (!t || t.dead || t.team === hero.team || !isVisibleTo(t, hero.team)) return false;
      if (hero.targetId !== t.id) cancelSwing(world, hero, 'retarget');
      hero.targetId = t.id;
      emit(world, { type: 'target_lock', heroId: hero.id, targetId: t.id });
      return true;
    }
    case 'clear_target':
      hero.targetId = null;
      cancelSwing(world, hero, 'clear_target');
      return true;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Mise à jour                                                          */
/* ------------------------------------------------------------------ */

export function step(world, dtMs) {
  if (world.over) return;
  world.events.length = 0;
  world.time += dtMs;

  for (const hero of world.heroes) {
    if (!hero.dead) updateHero(world, hero, dtMs);
  }
  updateProjectiles(world, dtMs);
  separateHeroes(world);
}

function updateHero(world, hero, dtMs) {
  // Verrou invalide : cible morte ou devenue invisible → désélection.
  if (hero.targetId !== null) {
    const t = getHero(world, hero.targetId);
    if (!t || t.dead || !isVisibleTo(t, hero.team)) {
      emit(world, { type: 'target_lost', heroId: hero.id, targetId: hero.targetId, reason: !t || t.dead ? 'dead' : 'invisible' });
      hero.targetId = null;
      cancelSwing(world, hero, 'target_lost');
    }
  }

  // Le déplacement suspend les autos. Le héros ne poursuit jamais la cible.
  if (hero.moveTarget) {
    moveHero(world, hero, dtMs);
    return;
  }

  const target = hero.targetId !== null ? getHero(world, hero.targetId) : null;
  if (!target) return;

  const auto = hero.def.auto;
  const inRange = edgeDistance(hero, target) <= auto.range;

  if (!hero.swing && inRange && world.time >= hero.nextAttackAt) {
    face(hero, target.x, target.y);
    hero.swing = { t: 0, hitDone: false, prevNextAttackAt: hero.nextAttackAt };
    hero.nextAttackAt = world.time + auto.intervalMs;
    emit(world, { type: 'swing_start', heroId: hero.id, targetId: target.id });
  }

  if (hero.swing) {
    hero.swing.t += dtMs;
    if (!hero.swing.hitDone && hero.swing.t >= hero.timing.hitMs) {
      hero.swing.hitDone = true;
      resolveImpact(world, hero, target);
    }
    if (hero.swing && hero.swing.t >= hero.timing.durationMs) hero.swing = null;
  }
}

function resolveImpact(world, hero, target) {
  const auto = hero.def.auto;
  if (auto.kind === 'melee') {
    // L'impact rate si la cible est sortie de la zone entre le départ et le contact.
    if (edgeDistance(hero, target) <= auto.range + (auto.hitSlack || 0)) {
      emit(world, { type: 'hit', heroId: hero.id, targetId: target.id });
      applyDamage(world, hero, target, hero.atk);
    } else {
      emit(world, { type: 'whiff', heroId: hero.id, targetId: target.id });
    }
  } else {
    // Une seule apparition de projectile par attaque, à l'image d'impact.
    const p = auto.projectile;
    world.projectiles.push({
      id: world.nextProjectileId++,
      ownerId: hero.id,
      team: hero.team,
      targetId: target.id,
      x: hero.x + hero.facing.x * hero.radius,
      y: hero.y + hero.facing.y * hero.radius,
      dir: { x: hero.facing.x, y: hero.facing.y },
      speed: p.speed,
      radius: p.radius,
      damage: hero.atk,
      lifeMs: p.maxLifeMs,
    });
    emit(world, { type: 'spawn_projectile', heroId: hero.id, targetId: target.id });
  }
}

function updateProjectiles(world, dtMs) {
  for (const p of world.projectiles) {
    const target = getHero(world, p.targetId);
    p.lifeMs -= dtMs;
    if (!target || target.dead || !isVisibleTo(target, p.team) || p.lifeMs <= 0) {
      p.done = true;
      continue;
    }
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) p.dir = { x: dx / dist, y: dy / dist };
    const move = (p.speed * dtMs) / 1000;
    if (dist - move <= target.radius + p.radius) {
      p.done = true;
      const owner = getHero(world, p.ownerId);
      emit(world, { type: 'hit', heroId: p.ownerId, targetId: target.id, projectileId: p.id });
      applyDamage(world, owner, target, p.damage);
    } else {
      p.x += p.dir.x * move;
      p.y += p.dir.y * move;
    }
  }
  world.projectiles = world.projectiles.filter((p) => !p.done);
}

export function applyDamage(world, source, target, raw) {
  if (target.dead) return 0;
  const amount = mitigate(raw, target.def_);
  target.hp = Math.max(0, target.hp - amount);
  emit(world, { type: 'damage', sourceId: source ? source.id : null, targetId: target.id, amount, hp: target.hp });
  if (target.hp === 0) {
    target.dead = true;
    target.swing = null;
    target.moveTarget = null;
    target.path = [];
    emit(world, { type: 'death', heroId: target.id, killerId: source ? source.id : null });
    // Lot 1 : un duel, la mort d'un héros termine la partie. La réapparition arrive au lot 2.
    world.over = { winnerTeam: source ? source.team : null, atMs: world.time };
    emit(world, { type: 'match_over', winnerTeam: world.over.winnerTeam });
  }
  return amount;
}

/* ------------------------------------------------------------------ */
/* Déplacement et collisions                                            */
/* ------------------------------------------------------------------ */

function moveHero(world, hero, dtMs) {
  const wp = hero.path.length ? hero.path[0] : hero.moveTarget;
  const dx = wp.x - hero.x;
  const dy = wp.y - hero.y;
  const dist = Math.hypot(dx, dy);
  const stepLen = (hero.speed * dtMs) / 1000;
  face(hero, wp.x, wp.y);

  if (dist <= stepLen) {
    hero.x = wp.x;
    hero.y = wp.y;
    pushOutOfObstacles(world, hero);
    if (hero.path.length > 1) hero.path.shift();
    else {
      hero.path = [];
      hero.moveTarget = null;
    }
    return;
  }

  const before = { x: hero.x, y: hero.y };
  hero.x += (dx / dist) * stepLen;
  hero.y += (dy / dist) * stepLen;
  pushOutOfObstacles(world, hero);

  // Bloqué (par l'autre héros, par exemple) : on abandonne l'ordre plutôt que de pousser indéfiniment.
  const moved = Math.hypot(hero.x - before.x, hero.y - before.y);
  if (moved < stepLen * 0.3) {
    hero.stuckMs += dtMs;
    if (hero.stuckMs >= STUCK_LIMIT_MS) {
      hero.moveTarget = null;
      hero.path = [];
      hero.stuckMs = 0;
    }
  } else {
    hero.stuckMs = 0;
  }
}

export function pushOutOfObstacles(world, hero) {
  const { width, height, obstacles } = world.map;
  hero.x = Math.min(width - hero.radius, Math.max(hero.radius, hero.x));
  hero.y = Math.min(height - hero.radius, Math.max(hero.radius, hero.y));
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) {
      if (o.type === 'circle') {
        const dx = hero.x - o.x;
        const dy = hero.y - o.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = o.r + hero.radius;
        if (d < min) {
          hero.x = o.x + (dx / d) * min;
          hero.y = o.y + (dy / d) * min;
        }
      } else {
        const hx = o.w / 2;
        const hy = o.h / 2;
        const cx = Math.min(o.x + hx, Math.max(o.x - hx, hero.x));
        const cy = Math.min(o.y + hy, Math.max(o.y - hy, hero.y));
        let dx = hero.x - cx;
        let dy = hero.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < hero.radius) {
          if (d < 0.001) {
            // Centre dans le rectangle : on sort par le côté le plus proche.
            const ox = hx - Math.abs(hero.x - o.x);
            const oy = hy - Math.abs(hero.y - o.y);
            if (ox < oy) hero.x = o.x + Math.sign(hero.x - o.x || 1) * (hx + hero.radius);
            else hero.y = o.y + Math.sign(hero.y - o.y || 1) * (hy + hero.radius);
          } else {
            hero.x = cx + (dx / d) * hero.radius;
            hero.y = cy + (dy / d) * hero.radius;
          }
        }
      }
    }
  }
  hero.x = Math.min(width - hero.radius, Math.max(hero.radius, hero.x));
  hero.y = Math.min(height - hero.radius, Math.max(hero.radius, hero.y));
}

function separateHeroes(world) {
  const hs = world.heroes.filter((h) => !h.dead);
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i];
      const b = hs[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = a.radius + b.radius;
      if (d < min) {
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
        pushOutOfObstacles(world, a);
        pushOutOfObstacles(world, b);
      }
    }
  }
}
