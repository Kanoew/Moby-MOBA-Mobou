// Cœur de simulation : aucune dépendance au DOM, au canvas ni au temps réel.
// Entrées = commandes (issueCommand). Sortie = état + événements. Le rendu ne fait que lire.
//
// Deux modes :
//  - duel  (sans `match`) : deux héros, la mort d'un héros termine la partie (lot 1).
//  - match (avec `match`) : lignes, tours, noyaux, vagues, mort et réapparition (lot 2).
import { unitVisibleTo } from './vision.js';
import { findPath } from './path.js';
import { initProgression, awardXp, spendPoint, tickPassiveXp } from './progression.js';
import { startCast, updateCast, updateZones, updateStatuses, effectiveSpeed, skillHitBonus, skillHeroHit } from './abilities.js';
import { awardGold, buyItem, effectiveDefense, emptyFx, heroAutoDamage, onHeroDamaged, sellItem, startingGold } from './shop.js';
import { cancelRecall, startRecall, updateRecall } from './recall.js';
import { initJungle, updateJungle, updateMonster, onMonsterKilled, chooseBonusLane, takeBonusWave } from './jungle.js';

export const TEAM_ALLY = 'ally';
export const TEAM_ENEMY = 'enemy';
export const otherTeam = (t) => (t === TEAM_ALLY ? TEAM_ENEMY : TEAM_ALLY);

const STUCK_LIMIT_MS = 250;
const HIT_KINDS = new Set(['hero', 'minion', 'monster']);

/** Durée totale et instant d'impact d'une attaque (durées d'images, ou valeurs directes pour sbires et tours). */
export function attackTiming(auto) {
  if (auto.frameDurationsMs) {
    const d = auto.frameDurationsMs;
    return {
      durationMs: d.reduce((a, b) => a + b, 0),
      hitMs: d.slice(0, auto.hitFrame).reduce((a, b) => a + b, 0),
    };
  }
  return { durationMs: auto.durationMs, hitMs: auto.hitMs };
}

/** Une seule Défense : dégâts = attaque × 100 / (100 + défense). */
export function mitigate(raw, def) {
  return Math.max(1, Math.round((raw * 100) / (100 + def)));
}

/** Délai de réapparition : interpolation linéaire entre les points du tableau, arrondie à la seconde. */
export function respawnDelayMs(match, timeMs) {
  const pts = match.respawn;
  const s = timeMs / 1000;
  let sec = pts[pts.length - 1].sec;
  if (s <= pts[0].atS) sec = pts[0].sec;
  else {
    for (let i = 1; i < pts.length; i++) {
      if (s <= pts[i].atS) {
        const a = pts[i - 1];
        const b = pts[i];
        sec = a.sec + ((b.sec - a.sec) * (s - a.atS)) / (b.atS - a.atS);
        break;
      }
    }
  }
  return Math.round(sec) * 1000;
}

export function newUnit(world, { id, kind, team, def, x, y, radius }) {
  const u = {
    id,
    kind,
    team,
    def,
    x,
    y,
    radius,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
    atk: def.stats.atk,
    def_: def.stats.def,
    speed: def.stats.speed,
    facing: { x: team === TEAM_ALLY ? 1 : -1, y: 0 },
    targetId: null,
    moveTarget: null,
    steer: null,
    approach: false,
    walking: false,
    path: [],
    swing: null,
    nextAttackAt: 0,
    invisible: false,
    dead: false,
    stuckMs: 0,
    thinkMs: 0,
    timing: def.auto ? attackTiming(def.auto) : null,
  };
  world.units.push(u);
  world.byId.set(id, u);
  return u;
}

export function spawnPoint(world, team, slot) {
  const sp = world.map.spawns[team];
  if (!world.match) return { x: sp.x, y: sp.y };
  const { dx, dy } = world.match.spawnSlots;
  const sign = team === TEAM_ALLY ? 1 : -1;
  return { x: sp.x + sign * dx, y: sp.y + (slot - 1) * dy };
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : la simulation reste déterministe. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld({ map, heroDefs, roster, match = null, seed = 1 }) {
  const world = {
    time: 0,
    map,
    heroDefs,
    match,
    units: [],
    byId: new Map(),
    heroes: [],
    towers: [],
    cores: [],
    projectiles: [],
    zones: [],
    nextZoneId: 1,
    events: [],
    over: null,
    nextId: 1,
    nextProjectileId: 1,
    nextWaveAt: match ? match.waves.firstMs : Infinity,
    pendingSpawns: [],
    stats: { ally: { kills: 0, towers: 0 }, enemy: { kills: 0, towers: 0 } },
    onEvent: null,
    rng: makeRng(seed),
  };

  const slots = { ally: 0, enemy: 0 };
  for (const r of roster) {
    const def = heroDefs[r.hero];
    const slot = slots[r.team]++;
    const p = spawnPoint(world, r.team, slot);
    const h = newUnit(world, { id: r.id, kind: 'hero', team: r.team, def, x: p.x, y: p.y, radius: def.stats.radius });
    Object.assign(h, {
      key: r.hero,
      controller: r.controller || 'player',
      lane: r.lane || null,
      slot,
      respawnAt: null,
      kills: 0,
      deaths: 0,
      assists: 0,
      damagers: {},
      // Économie (lot 4) : or, inventaire de trois emplacements, effets agrégés des objets, états du rappel.
      gold: startingGold(match),
      items: Array(match && match.items ? match.items.rules.inventorySlots : 3).fill(null),
      starterBought: false,
      fx: emptyFx(),
      lastCombatAt: -1e9,
      duel: { targetId: null, count: 0 },
      attackers: {},
      talismanReadyAt: 0,
      armorReadyAt: 0,
      defBuff: null,
      recall: null,
      // Tempérament du bot (déterministe via la graine) : seuil de repli et goût du combat.
      bravery: 0.2 + world.rng() * 0.2,
      aggression: 0.8 + world.rng() * 0.6,
    });
    initProgression(h, match);
    world.heroes.push(h);
  }

  if (match && map.lanes) {
    for (const team of [TEAM_ALLY, TEAM_ENEMY]) {
      const mx = (x) => (team === TEAM_ALLY ? x : map.width - x);
      for (const [lane, L] of Object.entries(map.lanes)) {
        for (const tier of ['outer', 'inner']) {
          const def = match.units[`tower-${tier}`];
          const [x, y] = L.towers[tier];
          const t = newUnit(world, { id: `tower-${team}-${lane}-${tier}`, kind: 'tower', team, def, x: mx(x), y, radius: def.radius });
          Object.assign(t, { lane, tier, aggro: null });
          world.towers.push(t);
        }
      }
      const cdef = match.units.core;
      const c = map.cores.ally;
      const core = newUnit(world, { id: `core-${team}`, kind: 'core', team, def: cdef, x: mx(c.x), y: c.y, radius: cdef.radius });
      world.cores.push(core);
    }
    initJungle(world);
  }
  return world;
}

export function getUnit(world, id) {
  return world.byId.get(id) || null;
}
export const getHero = getUnit;

export function isVisibleTo(u, team, world) {
  if (world) return unitVisibleTo(world, u, team);
  return u.team === team || !u.invisible;
}

export function isLaneDown(world, team, lane) {
  const ts = world.towers.filter((t) => t.team === team && t.lane === lane);
  return ts.length > 0 && ts.every((t) => t.dead);
}

/** Tours extérieures toujours ; intérieure après la chute de l'extérieure ; noyau dès qu'une ligne a perdu ses deux tours. */
export function isVulnerable(world, u) {
  if (u.dead) return false;
  if (u.kind === 'tower' && u.tier === 'inner') {
    const outer = world.towers.find((t) => t.team === u.team && t.lane === u.lane && t.tier === 'outer');
    return !outer || outer.dead;
  }
  if (u.kind === 'core') {
    return Object.keys(world.map.lanes || {}).some((lane) => isLaneDown(world, u.team, lane));
  }
  return true;
}

export function isTargetable(world, attacker, t) {
  return !!t && !t.dead && t.team !== attacker.team && isVisibleTo(t, attacker.team, world) && isVulnerable(world, t);
}

/** Distance entre les bords des deux cercles (portée mesurée de bord à bord). */
export function edgeDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.radius - b.radius;
}

export function emit(world, ev) {
  ev.t = world.time;
  world.events.push(ev);
  if (world.onEvent) world.onEvent(ev);
}

export function face(u, tx, ty) {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.001) u.facing = { x: dx / len, y: dy / len };
}

export function cancelSwing(world, u, reason) {
  if (!u.swing) return;
  // Annuler avant l'impact ne consomme pas la cadence.
  if (!u.swing.hitDone) u.nextAttackAt = u.swing.prevNextAttackAt;
  emit(world, { type: 'swing_cancel', heroId: u.id, reason });
  u.swing = null;
}

/* ------------------------------------------------------------------ */
/* Commandes : mêmes entrées pour le joueur et pour les bots           */
/* ------------------------------------------------------------------ */

export function issueCommand(world, heroId, cmd) {
  const hero = getUnit(world, heroId);
  if (!hero || hero.kind !== 'hero' || hero.dead || world.over) return false;
  if (hero.cast && (cmd.type === 'move' || cmd.type === 'steer')) return false; // un lancer en cours ne s'interrompt pas

  switch (cmd.type) {
    case 'skill':
    case 'ult': {
      const ok = startCast(world, hero, cmd.type, cmd.x !== undefined ? { x: cmd.x, y: cmd.y } : null);
      if (ok) cancelRecall(world, hero, 'cast');
      return ok;
    }
    case 'attack': {
      // Bouton d'attaque : verrouille ET s'approche de la cible tant qu'elle reste à portée de poursuite.
      // Exception voulue à « jamais de poursuite automatique » : c'est un ordre explicite du joueur, pas un clic de verrou.
      const t = getUnit(world, cmd.targetId);
      if (!isTargetable(world, hero, t)) return false;
      if (hero.targetId !== t.id) cancelSwing(world, hero, 'retarget');
      hero.targetId = t.id;
      hero.approach = true;
      hero.apPath = null;
      hero.moveTarget = null;
      hero.steer = null;
      hero.path = [];
      cancelRecall(world, hero, 'attack');
      emit(world, { type: 'target_lock', heroId: hero.id, targetId: t.id, approach: true });
      return true;
    }
    case 'recall':
      return startRecall(world, hero);
    case 'buy':
      return buyItem(world, hero, cmd.itemId).ok;
    case 'sell':
      return sellItem(world, hero, cmd.itemId).ok;
    case 'steer': {
      // Joystick : direction continue (vecteur), sans destination. Relâcher = vecteur nul.
      const len = Math.hypot(cmd.x || 0, cmd.y || 0);
      if (len < 0.001) {
        hero.steer = null;
        return true;
      }
      hero.steer = { x: cmd.x / len, y: cmd.y / len };
      hero.approach = false;
      cancelRecall(world, hero, 'move');
      hero.moveTarget = null;
      hero.path = [];
      cancelSwing(world, hero, 'move');
      return true;
    }
    case 'level_up':
      return spendPoint(world, heroId, cmd.slot);
    case 'choose_bonus_lane':
      return chooseBonusLane(world, heroId, cmd.lane);
    case 'move': {
      const x = Math.min(world.map.width - hero.radius, Math.max(hero.radius, cmd.x));
      const y = Math.min(world.map.height - hero.radius, Math.max(hero.radius, cmd.y));
      hero.path = findPath(world.map, hero.radius, { x: hero.x, y: hero.y }, { x, y });
      hero.moveTarget = { ...hero.path[hero.path.length - 1] };
      hero.steer = null;
      hero.approach = false;
      hero.stuckMs = 0;
      cancelRecall(world, hero, 'move');
      cancelSwing(world, hero, 'move');
      emit(world, { type: 'move_order', heroId: hero.id, x: hero.moveTarget.x, y: hero.moveTarget.y });
      return true;
    }
    case 'stop':
      hero.moveTarget = null;
      hero.steer = null;
      hero.approach = false;
      hero.path = [];
      return true;
    case 'target': {
      const t = getUnit(world, cmd.targetId);
      if (!isTargetable(world, hero, t)) return false;
      if (hero.targetId !== t.id) cancelSwing(world, hero, 'retarget');
      hero.targetId = t.id;
      hero.approach = false; // un simple verrou ne poursuit pas
      cancelRecall(world, hero, 'attack'); // verrouiller un ennemi lance une attaque : le rappel s'interrompt
      emit(world, { type: 'target_lock', heroId: hero.id, targetId: t.id });
      return true;
    }
    case 'clear_target':
      hero.targetId = null;
      hero.approach = false;
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
  if (world.match && world.match.timeLimitMs && world.time >= world.match.timeLimitMs) {
    endByTime(world);
    return;
  }

  if (world.match) {
    updateWaves(world);
    updateJungle(world);
  }

  for (const u of world.units.slice()) {
    if (world.over) break;
    if (u.kind === 'hero') updateHero(world, u, dtMs);
    else if (u.dead) continue;
    else if (u.kind === 'minion') updateMinion(world, u, dtMs);
    else if (u.kind === 'tower') updateTower(world, u, dtMs);
    else if (u.kind === 'monster') updateMonster(world, u, dtMs);
  }
  if (world.match) tickPassiveXp(world, dtMs);
  updateProjectiles(world, dtMs);
  updateZones(world, dtMs);
  updateStatuses(world);
  separateHeroes(world);
  separateMinions(world);
  if (world.match) updateBases(world, dtMs);
  if (world.units.some((u) => (u.kind === 'minion' || u.kind === 'monster') && u.dead)) {
    world.units = world.units.filter((u) => !((u.kind === 'minion' || u.kind === 'monster') && u.dead));
  }
}

/** Temps écoulé : l'équipe qui a le plus entamé les structures adverses gagne, puis les éliminations, sinon égalité. */
function endByTime(world) {
  const dealt = (team) => world.units.filter((u) => (u.kind === 'tower' || u.kind === 'core') && u.team !== team).reduce((a, u) => a + (u.maxHp - u.hp), 0);
  const a = dealt(TEAM_ALLY);
  const b = dealt(TEAM_ENEMY);
  let winnerTeam = null;
  if (Math.abs(a - b) > 1) winnerTeam = a > b ? TEAM_ALLY : TEAM_ENEMY;
  else if (world.stats.ally.kills !== world.stats.enemy.kills) winnerTeam = world.stats.ally.kills > world.stats.enemy.kills ? TEAM_ALLY : TEAM_ENEMY;
  world.over = { winnerTeam, atMs: world.time, reason: 'time', structureDamage: { ally: Math.round(a), enemy: Math.round(b) } };
  emit(world, { type: 'time_limit', winnerTeam });
  emit(world, { type: 'match_over', winnerTeam });
}

function updateHero(world, hero, dtMs) {
  hero.walking = false;
  if (hero.dead) {
    if (hero.respawnAt !== null && world.time >= hero.respawnAt) respawnHero(world, hero);
    return;
  }

  // Verrou invalide : cible morte, invisible ou devenue invulnérable → désélection.
  if (hero.targetId !== null) {
    const t = getUnit(world, hero.targetId);
    if (!isTargetable(world, hero, t)) {
      const reason = !t || t.dead ? 'dead' : !isVisibleTo(t, hero.team, world) ? 'invisible' : 'invulnerable';
      emit(world, { type: 'target_lost', heroId: hero.id, targetId: hero.targetId, reason });
      hero.targetId = null;
      hero.approach = false;
      cancelSwing(world, hero, 'target_lost');
    }
  }

  // Un lancer de compétence occupe le héros jusqu'à la fin de son animation.
  if (hero.cast) {
    updateCast(world, hero, dtMs);
    return;
  }
  // Rappel : danse sur place, autos suspendues.
  if (hero.recall) {
    updateRecall(world, hero, dtMs);
    return;
  }

  // Ordre « attaquer » : on s'approche de la cible jusqu'à la portée, puis les autos reprennent.
  if (hero.approach && !hero.steer && !hero.moveTarget && !hero.swing && hero.targetId !== null) {
    const t = getUnit(world, hero.targetId);
    if (t && edgeDistance(hero, t) > hero.def.auto.range) {
      const maxChase = world.match && world.match.attackAssist ? world.match.attackAssist.maxChase : 900;
      if (Math.hypot(t.x - hero.x, t.y - hero.y) > maxChase) hero.approach = false; // trop loin : on renonce
      else {
        approachStep(world, hero, t, dtMs);
        return;
      }
    }
  }
  // Le déplacement (clic ou joystick) suspend les autos. Le héros ne poursuit jamais la cible de lui-même.
  if (hero.steer) {
    steerHero(world, hero, dtMs);
    return;
  }
  if (hero.moveTarget) {
    moveHero(world, hero, dtMs);
    return;
  }

  const target = hero.targetId !== null ? getUnit(world, hero.targetId) : null;
  if (!target) return;
  combatTick(world, hero, target, dtMs);
}

/** Démarre un coup si possible (à portée, cadence prête), puis fait avancer le coup en cours. */
export function combatTick(world, u, target, dtMs) {
  const auto = u.def.auto;
  if (!u.swing && edgeDistance(u, target) <= auto.range && world.time >= u.nextAttackAt) {
    face(u, target.x, target.y);
    u.swing = { t: 0, hitDone: false, prevNextAttackAt: u.nextAttackAt, targetId: target.id };
    u.nextAttackAt = world.time + auto.intervalMs;
    emit(world, { type: 'swing_start', heroId: u.id, targetId: target.id });
  }
  if (u.swing) {
    u.swing.t += dtMs;
    if (!u.swing.hitDone && u.swing.t >= u.timing.hitMs) {
      u.swing.hitDone = true;
      resolveImpact(world, u, getUnit(world, u.swing.targetId));
    }
    if (u.swing && u.swing.t >= u.timing.durationMs) u.swing = null;
  }
}

function resolveImpact(world, u, target) {
  const auto = u.def.auto;
  if (!isTargetable(world, u, target)) return;
  if (auto.kind === 'melee') {
    // L'impact rate si la cible est sortie de la zone entre le départ et le contact.
    if (edgeDistance(u, target) <= auto.range + (auto.hitSlack || 0)) {
      emit(world, { type: 'hit', heroId: u.id, targetId: target.id });
      applyDamage(world, u, target, u.kind === 'hero' ? heroAutoDamage(world, u, target) : u.atk * (u.autoMult || 1));
    } else {
      emit(world, { type: 'whiff', heroId: u.id, targetId: target.id });
    }
  } else {
    // Une seule apparition de projectile par attaque, à l'instant d'impact.
    const p = auto.projectile;
    world.projectiles.push({
      id: world.nextProjectileId++,
      ownerId: u.id,
      ownerKind: u.kind,
      team: u.team,
      targetId: target.id,
      x: u.x + u.facing.x * u.radius,
      y: u.y + u.facing.y * u.radius,
      dir: { x: u.facing.x, y: u.facing.y },
      speed: p.speed,
      radius: p.radius,
      damage: u.kind === 'hero' ? heroAutoDamage(world, u, target) : u.atk * (u.autoMult || 1),
      lifeMs: p.maxLifeMs,
    });
    emit(world, { type: 'spawn_projectile', heroId: u.id, targetId: target.id });
  }
}

function updateProjectiles(world, dtMs) {
  for (const p of world.projectiles) {
    p.lifeMs -= dtMs;
    const move = (p.speed * dtMs) / 1000;
    if (p.straight) {
      // Projectile de compétence : ligne droite, touche le premier ennemi rencontré, portée limitée.
      const owner = getUnit(world, p.ownerId);
      let hit = null;
      for (const e of world.units) {
        if (e.dead || e.team === p.team || !HIT_KINDS.has(e.kind) || !isVisibleTo(e, p.team)) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) <= e.radius + p.radius) {
          hit = e;
          break;
        }
      }
      if (hit) {
        p.done = true;
        emit(world, { type: 'hit', heroId: p.ownerId, targetId: hit.id, projectileId: p.id, skill: true });
        const bonus = p.cast && owner ? skillHitBonus(owner, p.cast, hit.id) : 0;
        applyDamage(world, owner, hit, p.damage + bonus);
        if (p.cast && owner) skillHeroHit(world, owner, p.cast, hit);
      } else {
        p.x += p.dir.x * move;
        p.y += p.dir.y * move;
        p.rangeLeft -= move;
        if (p.rangeLeft <= 0 || p.lifeMs <= 0) p.done = true;
      }
      continue;
    }
    const target = getUnit(world, p.targetId);
    if (!target || target.dead || !isVisibleTo(target, p.team) || p.lifeMs <= 0) {
      p.done = true;
      continue;
    }
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) p.dir = { x: dx / dist, y: dy / dist };
    if (dist - move <= target.radius + p.radius) {
      p.done = true;
      const owner = getUnit(world, p.ownerId);
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
  if (target.dead || world.over) return 0;
  const hpBefore = target.hp;
  let amount = mitigate(raw, effectiveDefense(world, target));
  // Le bouclier absorbe après la Défense et avant les PV.
  let absorbed = 0;
  if (target.shield) {
    absorbed = Math.min(target.shield.amount, amount);
    target.shield.amount -= absorbed;
    amount -= absorbed;
    if (target.shield.amount <= 0) {
      target.shield = null;
      emit(world, { type: 'shield_off', heroId: target.id, broken: true });
    }
  }
  target.hp = Math.max(0, target.hp - amount);
  emit(world, { type: 'damage', sourceId: source ? source.id : null, targetId: target.id, amount, absorbed, hp: target.hp });
  if (world.match) {
    if (source && source.kind === 'hero') source.lastCombatAt = world.time;
    if (target.kind === 'hero') {
      target.lastCombatAt = world.time;
      cancelRecall(world, target, 'damage'); // tout dégât, même absorbé, interrompt le rappel
      if (target.hp > 0) onHeroDamaged(world, target, source, hpBefore);
    }
  }
  if (target.kind === 'monster' && source && source.team !== 'neutral') {
    target.aggroId = source.id;
    // Tout le camp se défend ensemble.
    const camp = target.campId ? world.camps.find((c) => c.id === target.campId) : null;
    if (camp) for (const id of camp.unitIds) if (!getUnit(world, id).dead) getUnit(world, id).aggroId = source.id;
  }

  if (source && source.kind === 'hero' && target.kind === 'hero') {
    target.damagers[source.id] = world.time;
    // Un héros qui frappe un défenseur sous sa tour attire les tirs, s'il est à portée.
    if (world.match) {
      for (const t of world.towers) {
        if (t.team === target.team && !t.dead && edgeDistance(t, source) <= t.def.auto.range) {
          t.aggro = { id: source.id, until: world.time + world.match.towerAggroMs };
        }
      }
    }
  }
  if (target.hp === 0) kill(world, source, target);
  return amount;
}

function kill(world, source, target) {
  target.dead = true;
  target.swing = null;
  target.moveTarget = null;
  target.steer = null;
  target.approach = false;
  target.path = [];
  target.targetId = null;
  target.shield = null;
  target.cast = null;
  target.recall = null;
  target.dashing = false;

  if (target.kind === 'hero') {
    const killer = source && source.kind === 'hero' ? source : null;
    target.deaths++;
    if (killer) {
      killer.kills++;
      world.stats[killer.team].kills++;
    }
    const win = world.match ? world.match.assistWindowMs : 0;
    for (const [id, t] of Object.entries(target.damagers)) {
      if ((!killer || id !== killer.id) && world.time - t <= win) {
        getUnit(world, id).assists++;
        if (world.match) awardGold(world, getUnit(world, id), world.match.economy.assistGold);
      }
    }
    if (killer && world.match) awardGold(world, killer, world.match.economy.killGold);
    target.damagers = {};
    if (world.match) {
      const kx = world.match.progression.heroKillXp;
      awardXp(world, otherTeam(target.team), target.x, target.y, kx.base + kx.perLevel * target.level);
    }
    emit(world, { type: 'death', heroId: target.id, killerId: source ? source.id : null });
    if (world.match) {
      target.respawnAt = world.time + respawnDelayMs(world.match, world.time);
    } else {
      // Duel : la mort d'un héros termine la partie.
      world.over = { winnerTeam: source ? source.team : null, atMs: world.time };
      emit(world, { type: 'match_over', winnerTeam: world.over.winnerTeam });
    }
  } else if (target.kind === 'tower') {
    world.stats[otherTeam(target.team)].towers++;
    emit(world, { type: 'tower_destroyed', unitId: target.id, team: target.team, lane: target.lane, tier: target.tier });
  } else if (target.kind === 'core') {
    world.over = { winnerTeam: otherTeam(target.team), atMs: world.time, reason: 'core' };
    emit(world, { type: 'core_destroyed', team: target.team });
    emit(world, { type: 'match_over', winnerTeam: world.over.winnerTeam });
  } else if (target.kind === 'monster') {
    emit(world, { type: 'monster_died', unitId: target.id, boss: !!target.boss });
    onMonsterKilled(world, source, target);
  } else {
    if (world.match) awardXp(world, otherTeam(target.team), target.x, target.y, target.def.xp);
    if (source && source.kind === 'hero') awardGold(world, source, target.def.gold || 0); // or au dernier coup
    emit(world, { type: 'minion_died', unitId: target.id });
  }
}

function respawnHero(world, hero) {
  const p = spawnPoint(world, hero.team, hero.slot);
  hero.x = p.x;
  hero.y = p.y;
  hero.hp = hero.maxHp;
  hero.dead = false;
  hero.respawnAt = null;
  hero.swing = null;
  hero.cast = null;
  hero.slow = null;
  hero.shield = null;
  hero.nextAttackAt = world.time;
  emit(world, { type: 'respawn', heroId: hero.id });
}

/* ------------------------------------------------------------------ */
/* Vagues, sbires, tours                                                */
/* ------------------------------------------------------------------ */

function lanePath(world, team, lane) {
  const pts = world.map.lanes[lane].points.map(([x, y]) => ({ x, y }));
  return team === TEAM_ALLY ? pts : pts.reverse();
}

function updateWaves(world) {
  const m = world.match;
  if (world.time >= world.nextWaveAt) {
    for (const lane of Object.keys(world.map.lanes)) {
      for (const team of [TEAM_ALLY, TEAM_ENEMY]) {
        const comp = m.waves.composition.concat(takeBonusWave(world, team, lane));
        comp.forEach((type, i) => {
          world.pendingSpawns.push({ at: world.time + i * m.waves.staggerMs, team, lane, type });
        });
      }
    }
    emit(world, { type: 'wave_spawn' });
    world.nextWaveAt += m.waves.intervalMs;
  }
  if (world.pendingSpawns.length) {
    const due = world.pendingSpawns.filter((s) => s.at <= world.time);
    if (due.length) {
      world.pendingSpawns = world.pendingSpawns.filter((s) => s.at > world.time);
      for (const s of due) spawnMinion(world, s);
    }
  }
}

function spawnMinion(world, { team, lane, type }) {
  const def = world.match.units[type];
  const path = lanePath(world, team, lane);
  const n = world.nextId++;
  const jitter = ((n % 3) - 1) * 16;
  const u = newUnit(world, { id: `m${n}`, kind: 'minion', team, def, x: path[0].x, y: path[0].y + jitter, radius: def.radius });
  Object.assign(u, { lane, path, wp: 1, minionType: type });
  emit(world, { type: 'minion_spawn', unitId: u.id, team, lane });
}

function acquire(world, u, aggro) {
  let best = null;
  let bestTier = 9;
  let bestD = Infinity;
  for (const e of world.units) {
    if (e.team === 'neutral' || !isTargetable(world, u, e)) continue;
    const tier = e.kind === 'minion' ? 0 : e.kind === 'hero' ? 1 : 2;
    const d = edgeDistance(u, e);
    if (d > aggro) continue;
    if (tier < bestTier || (tier === bestTier && d < bestD)) {
      best = e;
      bestTier = tier;
      bestD = d;
    }
  }
  return best;
}

export function stepToward(world, u, x, y, dtMs, mult = 1) {
  const dx = x - u.x;
  const dy = y - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return;
  const s = Math.min(d, (effectiveSpeed(world, u) * mult * dtMs) / 1000);
  u.x += (dx / d) * s;
  u.y += (dy / d) * s;
  face(u, x, y);
}

function updateMinion(world, u, dtMs) {
  const ai = u.def.ai;
  let t = u.targetId ? getUnit(world, u.targetId) : null;
  if (t && (!isTargetable(world, u, t) || Math.hypot(t.x - u.x, t.y - u.y) > ai.leash)) {
    cancelSwing(world, u, 'target_lost');
    u.targetId = null;
    t = null;
  }
  if (!t) {
    u.thinkMs -= dtMs;
    if (u.thinkMs <= 0) {
      u.thinkMs = 200;
      t = acquire(world, u, ai.aggro);
      u.targetId = t ? t.id : null;
    }
  }

  if (t) {
    if (u.swing || edgeDistance(u, t) <= u.def.auto.range) combatTick(world, u, t, dtMs);
    else stepToward(world, u, t.x, t.y, dtMs);
    return;
  }
  const wp = u.path[u.wp];
  if (Math.hypot(wp.x - u.x, wp.y - u.y) < 20) {
    if (u.wp < u.path.length - 1) u.wp++;
    return;
  }
  stepToward(world, u, wp.x, wp.y, dtMs);
}

function updateTower(world, tw, dtMs) {
  const range = tw.def.auto.range;
  const inReach = (e) => isTargetable(world, tw, e) && edgeDistance(tw, e) <= range;
  let target = tw.targetId ? getUnit(world, tw.targetId) : null;
  if (!inReach(target)) {
    tw.targetId = null;
    target = null;
  }
  if (!tw.swing) {
    // Priorité : le héros qui vient de frapper un défenseur, puis les sbires, puis les héros.
    let pick = null;
    if (tw.aggro && world.time < tw.aggro.until) {
      const a = getUnit(world, tw.aggro.id);
      if (inReach(a)) pick = a;
    }
    if (!pick) {
      for (const tier of ['minion', 'hero']) {
        let bestD = Infinity;
        for (const e of world.units) {
          if (e.kind !== tier || !inReach(e)) continue;
          const d = edgeDistance(tw, e);
          if (d < bestD) {
            pick = e;
            bestD = d;
          }
        }
        if (pick) break;
      }
    }
    target = pick;
    tw.targetId = pick ? pick.id : null;
  }
  if (target || tw.swing) {
    if (target) face(tw, target.x, target.y);
    combatTick(world, tw, target || getUnit(world, tw.swing.targetId), dtMs);
  }
}

/** Zone de départ : confinement avant l'ouverture des sorties, soin dans sa propre base. */
function updateBases(world, dtMs) {
  const m = world.match;
  for (const h of world.heroes) {
    if (h.dead) continue;
    const sp = world.map.spawns[h.team];
    const d = Math.hypot(h.x - sp.x, h.y - sp.y);
    if (world.time < m.spawnOpenMs && d > m.spawnZoneRadius - h.radius) {
      const k = (m.spawnZoneRadius - h.radius) / d;
      h.x = sp.x + (h.x - sp.x) * k;
      h.y = sp.y + (h.y - sp.y) * k;
    }
    if (d <= m.spawnZoneRadius && h.hp < h.maxHp) {
      h.hp = Math.min(h.maxHp, h.hp + (h.maxHp * m.baseRegenPctPerSec * dtMs) / 1000);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Déplacement et collisions                                            */
/* ------------------------------------------------------------------ */

function approachStep(world, hero, t, dtMs) {
  // Chemin recalculé toutes les 300 ms : la poursuite contourne rochers et blocs comme un déplacement normal.
  if (!hero.apPath || world.time >= hero.apRepath) {
    hero.apPath = findPath(world.map, hero.radius, { x: hero.x, y: hero.y }, { x: t.x, y: t.y });
    hero.apRepath = world.time + 300;
  }
  while (hero.apPath.length > 1 && Math.hypot(hero.apPath[0].x - hero.x, hero.apPath[0].y - hero.y) < 24) hero.apPath.shift();
  const goal = hero.apPath.length > 1 ? hero.apPath[0] : { x: t.x, y: t.y };
  const dx = goal.x - hero.x;
  const dy = goal.y - hero.y;
  const d = Math.hypot(dx, dy) || 1;
  const s = (effectiveSpeed(world, hero) * dtMs) / 1000;
  const bx = hero.x;
  const by = hero.y;
  hero.x += (dx / d) * s;
  hero.y += (dy / d) * s;
  face(hero, goal.x, goal.y);
  pushOutOfObstacles(world, hero);
  hero.walking = true;
  // Bloqué derrière un obstacle : on abandonne plutôt que de pousser indéfiniment.
  if (Math.hypot(hero.x - bx, hero.y - by) < s * 0.3) {
    hero.stuckMs += dtMs;
    if (hero.stuckMs >= 500) {
      hero.approach = false;
      hero.stuckMs = 0;
    }
  } else hero.stuckMs = 0;
}

function steerHero(world, hero, dtMs) {
  const s = effectiveSpeed(world, hero) * dtMs / 1000;
  hero.x += hero.steer.x * s;
  hero.y += hero.steer.y * s;
  hero.walking = true;
  face(hero, hero.x + hero.steer.x, hero.y + hero.steer.y);
  pushOutOfObstacles(world, hero);
}

function moveHero(world, hero, dtMs) {
  const wp = hero.path.length ? hero.path[0] : hero.moveTarget;
  const dx = wp.x - hero.x;
  const dy = wp.y - hero.y;
  const dist = Math.hypot(dx, dy);
  const stepLen = (effectiveSpeed(world, hero) * dtMs) / 1000;
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
        const dx = hero.x - cx;
        const dy = hero.y - cy;
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
  const hs = world.heroes.filter((h) => !h.dead && !h.dashing);
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

/** Les sbires s'écartent un peu les uns des autres ; ils ne bloquent pas les héros. */
function separateMinions(world) {
  const ms = world.units.filter((u) => u.kind === 'minion' && !u.dead);
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i];
      const b = ms[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = (a.radius + b.radius) * 0.8;
      if (d < min) {
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }
}
