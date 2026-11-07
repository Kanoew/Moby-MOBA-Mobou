// Compétences et ultimes : lancer (animation + événements), zones, ralentissement, bouclier.
// Les instants (impact, apparition, activation) viennent des données issues des packs d'animation.
import { applyDamage, cancelSwing, edgeDistance, emit, face, getUnit, isTargetable, pushOutOfObstacles } from './world.js';

const at = (arr, rank) => arr[Math.min(Math.max(rank, 1), arr.length) - 1];
const HITTABLE = new Set(['hero', 'minion', 'monster']);

export function abilityOf(hero, slot) {
  return hero.def.abilities ? hero.def.abilities[slot] || null : null;
}

export function cooldownLeft(world, hero, slot) {
  return Math.max(0, hero.cd[slot] - world.time);
}

export function canCast(world, hero, slot) {
  if (world.over || hero.dead || hero.cast) return false;
  if (!abilityOf(hero, slot)) return false;
  if (hero.rank[slot] < 1) return false;
  return world.time >= hero.cd[slot];
}

function abilityDamage(ab, rank, atk) {
  return at(ab.damage.base, rank) + ab.damage.coef * atk;
}

/** Courbe de déplacement : points [temps ms, fraction de la distance], interpolation linéaire. */
export function curveAt(curve, t) {
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (t <= curve[i][0]) {
      const [t0, f0] = curve[i - 1];
      const [t1, f1] = curve[i];
      return t1 === t0 ? f1 : f0 + ((f1 - f0) * (t - t0)) / (t1 - t0);
    }
  }
  return curve[curve.length - 1][1];
}

function rotate(v, deg) {
  const a = (deg * Math.PI) / 180;
  // Angles positifs = sens horaire à l'écran (axe y vers le bas).
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
}

/** Lance la compétence. `aim` = point visé dans le monde (facultatif). Retourne vrai si lancée. */
export function startCast(world, hero, slot, aim) {
  if (!canCast(world, hero, slot)) return false;
  const ab = abilityOf(hero, slot);
  const rank = hero.rank[slot];

  let dir = null;
  let distance = 0;
  if (ab.kind === 'dash' || ab.kind === 'fan') {
    let ax = aim ? aim.x : hero.x + hero.facing.x;
    let ay = aim ? aim.y : hero.y + hero.facing.y;
    const t = hero.targetId !== null ? getUnit(world, hero.targetId) : null;
    if (ab.kind === 'dash') {
      distance = at(ab.range, rank);
      // Dash vers la cible verrouillée si elle est dans la portée, sinon vers la direction visée.
      if (t && isTargetable(world, hero, t) && edgeDistance(hero, t) <= distance) {
        ax = t.x;
        ay = t.y;
        distance = Math.min(distance, Math.hypot(t.x - hero.x, t.y - hero.y) + (ab.endsPast || 0));
      }
    } else if (!aim && t && isTargetable(world, hero, t)) {
      ax = t.x;
      ay = t.y;
    }
    const len = Math.hypot(ax - hero.x, ay - hero.y);
    dir = len > 1 ? { x: (ax - hero.x) / len, y: (ay - hero.y) / len } : { ...hero.facing };
  }

  cancelSwing(world, hero, 'cast');
  hero.moveTarget = null;
  hero.steer = null;
  hero.path = [];
  hero.cd[slot] = world.time + at(ab.cooldownMs, rank);
  hero.cast = { slot, ab, rank, t: 0, dir, start: { x: hero.x, y: hero.y }, distance, fired: false, hit: new Set(), stopped: false };
  if (dir) face(hero, hero.x + dir.x, hero.y + dir.y);
  emit(world, { type: 'cast_start', heroId: hero.id, slot, rank });
  return true;
}

function segDist(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function hitUnit(world, hero, c, e) {
  c.hit.add(e.id);
  emit(world, { type: 'ability_hit', heroId: hero.id, targetId: e.id, slot: c.slot });
  applyDamage(world, hero, e, abilityDamage(c.ab, c.rank, hero.atk));
}

function updateDash(world, hero, c, dt) {
  const ab = c.ab;
  const f = curveAt(ab.movementCurve, c.t);
  const traveling = !c.stopped && f > 0 && f < 1;
  hero.dashing = !!ab.pass && traveling;
  if (!c.stopped) {
    const tx = c.start.x + c.dir.x * c.distance * f;
    const ty = c.start.y + c.dir.y * c.distance * f;
    const dx = tx - hero.x;
    const dy = ty - hero.y;
    const want = Math.hypot(dx, dy);
    if (want > 0.01) {
      // Petits pas de 8 px : pas de traversée d'un obstacle ni d'un ennemi à haute vitesse.
      const n = Math.max(1, Math.ceil(want / 8));
      const sx = dx / n;
      const sy = dy / n;
      const sl = want / n;
      for (let i = 0; i < n && !c.stopped; i++) {
        const bx = hero.x;
        const by = hero.y;
        hero.x += sx;
        hero.y += sy;
        pushOutOfObstacles(world, hero);
        // Bloqué par un obstacle : le dash s'arrête là.
        if (sl > 0.5 && Math.hypot(hero.x - bx, hero.y - by) < sl * 0.4) {
          c.stopped = true;
          break;
        }
        if (!ab.pass) {
          // Ruée : s'arrête au contact de la première cible touchée.
          for (const e of world.units) {
            if (!HITTABLE.has(e.kind) || !isTargetable(world, hero, e)) continue;
            if (edgeDistance(hero, e) <= ab.contactSlack) {
              c.stopped = true;
              hitUnit(world, hero, c, e);
              break;
            }
          }
        }
      }
    }
  }
  if (ab.pass && c.t >= ab.strikeMs) {
    // Coupe : touche une fois chaque ennemi croisé, à partir de l'instant de frappe.
    for (const e of world.units) {
      if (!HITTABLE.has(e.kind) || c.hit.has(e.id) || !isTargetable(world, hero, e)) continue;
      if (segDist(e.x, e.y, c.start, hero) <= ab.hitRadius + e.radius) hitUnit(world, hero, c, e);
    }
  }
}

export function updateCast(world, hero, dt) {
  const c = hero.cast;
  const ab = c.ab;
  c.t += dt;

  if (ab.kind === 'dash') updateDash(world, hero, c, dt);
  else if (ab.kind === 'fan' && !c.fired && c.t >= ab.fireMs) {
    c.fired = true;
    const dmg = abilityDamage(ab, c.rank, hero.atk);
    for (const deg of ab.anglesDeg) {
      const d = rotate(c.dir, deg);
      world.projectiles.push({
        id: world.nextProjectileId++,
        ownerId: hero.id,
        ownerKind: 'hero',
        team: hero.team,
        targetId: null,
        straight: true,
        skill: true,
        x: hero.x + c.dir.x * hero.radius,
        y: hero.y + c.dir.y * hero.radius,
        dir: d,
        speed: ab.projectile.speed,
        radius: ab.projectile.radius,
        damage: dmg,
        rangeLeft: at(ab.range, c.rank),
        lifeMs: 5000,
      });
    }
    emit(world, { type: 'spawn_projectile_fan', heroId: hero.id, count: ab.anglesDeg.length });
  } else if (ab.kind === 'slow_zone' && !c.fired && c.t >= ab.zoneStartMs) {
    c.fired = true;
    world.zones.push({
      id: world.nextZoneId++,
      kind: 'slow',
      ownerId: hero.id,
      slot: c.slot,
      team: hero.team,
      x: hero.x,
      y: hero.y,
      followId: hero.id,
      radius: ab.radius,
      startAt: world.time,
      armAt: world.time,
      endAt: world.time + ab.durationMs,
      slow: at(ab.slow, c.rank),
    });
    emit(world, { type: 'zone_start', heroId: hero.id, kind: 'slow' });
  } else if (ab.kind === 'thorns' && !c.fired && c.t >= ab.spawnMs) {
    c.fired = true;
    world.zones.push({
      id: world.nextZoneId++,
      kind: 'thorns',
      ownerId: hero.id,
      slot: c.slot,
      team: hero.team,
      x: hero.x,
      y: hero.y,
      followId: null,
      radius: ab.radius,
      startAt: world.time,
      armAt: world.time + ab.armDelayMs,
      endAt: world.time + ab.armDelayMs + ab.sustainMs,
      burst: abilityDamage({ damage: ab.burst }, c.rank, hero.atk),
      burstDone: false,
      tickRaw: abilityDamage({ damage: ab.tick }, c.rank, hero.atk),
      tickEveryMs: ab.tick.everyMs,
      nextTickAt: world.time + ab.armDelayMs + ab.tick.everyMs,
    });
    emit(world, { type: 'zone_start', heroId: hero.id, kind: 'thorns' });
  } else if (ab.kind === 'shield' && !c.fired && c.t >= ab.shieldOnMs) {
    c.fired = true;
    const amount = at(ab.amount, c.rank);
    hero.shield = { amount, max: amount, since: world.time, until: world.time + ab.durationMs };
    emit(world, { type: 'shield_on', heroId: hero.id, amount });
  }

  if (c.t >= ab.lockMs) {
    hero.cast = null;
    hero.dashing = false;
    emit(world, { type: 'cast_end', heroId: hero.id, slot: c.slot });
  }
}

/* ------------------------------ zones, statuts ------------------------------ */

export function applySlow(world, unit, frac, durationMs) {
  if (!unit.slow || world.time >= unit.slow.until || frac >= unit.slow.frac) {
    unit.slow = { frac, until: world.time + durationMs };
  }
}

export function effectiveSpeed(world, unit) {
  if (!unit.slow || world.time >= unit.slow.until) return unit.speed;
  const floor = world.match ? world.match.slowMinSpeed : 0.4;
  return unit.speed * Math.max(floor, 1 - unit.slow.frac);
}

function inZone(world, z) {
  return world.units.filter(
    (e) => !e.dead && HITTABLE.has(e.kind) && e.team !== z.team && !e.invisible && Math.hypot(e.x - z.x, e.y - z.y) <= z.radius + e.radius * 0.5,
  );
}

export function updateZones(world, dt) {
  if (!world.zones.length) return;
  for (const z of world.zones) {
    const owner = getUnit(world, z.ownerId);
    if (z.followId) {
      if (!owner || owner.dead) z.endAt = Math.min(z.endAt, world.time);
      else {
        z.x = owner.x;
        z.y = owner.y;
      }
    }
    if (world.time >= z.endAt) {
      z.done = true;
      emit(world, { type: 'zone_end', zoneId: z.id, kind: z.kind });
      continue;
    }
    if (world.time < z.armAt) continue;
    if (z.kind === 'slow') {
      for (const e of inZone(world, z)) applySlow(world, e, z.slow, 250);
    } else if (z.kind === 'thorns') {
      if (!z.burstDone) {
        z.burstDone = true;
        for (const e of inZone(world, z)) applyDamage(world, owner, e, z.burst);
      }
      while (world.time >= z.nextTickAt && z.nextTickAt <= z.endAt) {
        z.nextTickAt += z.tickEveryMs;
        for (const e of inZone(world, z)) applyDamage(world, owner, e, z.tickRaw);
      }
    }
  }
  world.zones = world.zones.filter((z) => !z.done);
}

export function updateStatuses(world) {
  for (const u of world.units) {
    if (u.shield && world.time >= u.shield.until) {
      emit(world, { type: 'shield_off', heroId: u.id });
      u.shield = null;
    }
    if (u.slow && world.time >= u.slow.until) u.slow = null;
  }
}
