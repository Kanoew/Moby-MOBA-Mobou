// Jungle : petits camps symétriques, boss au centre exact, récompense de vague renforcée.
import { applyDamage, combatTick, edgeDistance, emit, face, getUnit, isTargetable, newUnit, stepToward } from './world.js';
import { awardXp } from './progression.js';
import { awardGold } from './shop.js';

const TEAMS = ['ally', 'enemy'];

export function initJungle(world) {
  const { match, map } = world;
  world.camps = [];
  match.jungle.camps.forEach((c) => {
    for (const side of TEAMS) {
      // Les camps de l'autre côté sont le miroir exact : mêmes distances d'accès pour les deux équipes.
      const x = side === 'ally' ? c.x : map.width - c.x;
      const flip = side === 'ally' ? 1 : -1;
      world.camps.push({
        id: `camp-${side}-${c.id}`,
        kind: c.id,
        side,
        x,
        y: c.y,
        units: c.units.map((u) => ({ type: u.type, dx: u.dx * flip, dy: u.dy })),
        unitIds: [],
        respawnAt: match.jungle.startMs,
      });
    }
  });
  world.boss = {
    unitId: null,
    announced: false,
    announceAt: match.boss.announceMs,
    spawnAt: match.boss.spawnMs,
    kills: { ally: 0, enemy: 0 },
  };
  world.bonus = { choices: [], pending: { ally: {}, enemy: {} } };
  for (const lane of Object.keys(map.lanes)) for (const t of TEAMS) world.bonus.pending[t][lane] = 0;
}

function spawnMonster(world, type, x, y, campId) {
  const def = world.match.units[type];
  const n = world.nextId++;
  const u = newUnit(world, { id: `mon${n}`, kind: 'monster', team: 'neutral', def, x, y, radius: def.radius });
  Object.assign(u, { monType: type, home: { x, y }, campId, aggroId: null, boss: !!def.boss, special: null, specialReadyAt: 0 });
  u.facing = { x: 0, y: 1 }; // les monstres attendent de face
  return u;
}

export function updateJungle(world) {
  const { match } = world;
  for (const camp of world.camps) {
    if (camp.respawnAt !== null && world.time >= camp.respawnAt) {
      camp.respawnAt = null;
      camp.unitIds = camp.units.map((c) => spawnMonster(world, c.type, camp.x + c.dx, camp.y + c.dy, camp.id).id);
      emit(world, { type: 'camp_spawn', campId: camp.id });
    }
  }

  const b = world.boss;
  if (b.unitId === null) {
    if (!b.announced && world.time >= b.announceAt) {
      b.announced = true;
      emit(world, { type: 'boss_announce', spawnInMs: b.spawnAt - world.time });
    }
    if (world.time >= b.spawnAt) {
      b.unitId = spawnMonster(world, 'boss', match.boss.x, match.boss.y, null).id;
      emit(world, { type: 'boss_spawn', unitId: b.unitId });
    }
  }

  for (const ch of world.bonus.choices) {
    if (!ch.lane && world.time >= ch.expiresAt) resolveBonus(world, ch, match.boss.defaultLane, true);
  }
  world.bonus.choices = world.bonus.choices.filter((c) => !c.lane || world.time - c.resolvedAt < 3000);
}

export function updateMonster(world, u, dtMs) {
  const j = world.match.jungle;
  const leash = u.def.leash || (u.boss ? 700 : j.leash);
  let t = u.aggroId ? getUnit(world, u.aggroId) : null;
  const far = Math.hypot(u.x - u.home.x, u.y - u.home.y) > leash;
  if (t && (!isTargetable(world, u, t) || far)) {
    u.aggroId = null;
    if (u.swing) u.swing = null;
    t = null;
  }
  const sp = u.def.special;
  if (u.special) {
    advanceSpecial(world, u, dtMs);
    return;
  }
  if (t) {
    // Souffle en cône : dès qu'il est prêt et que la cible est à portée, sinon morsure.
    if (sp && !u.swing && world.time >= u.specialReadyAt && Math.hypot(t.x - u.x, t.y - u.y) <= sp.range * 0.9) {
      face(u, t.x, t.y);
      u.special = { t: 0, hit: false, dir: { ...u.facing } };
      u.specialReadyAt = world.time + sp.cooldownMs;
      emit(world, { type: 'special_start', unitId: u.id, kind: sp.kind });
      return;
    }
    if (u.swing || edgeDistance(u, t) <= u.def.auto.range) combatTick(world, u, t, dtMs);
    else stepToward(world, u, t.x, t.y, dtMs);
    return;
  }
  // Sans cible : retour au point d'attache, soin rapide.
  if (Math.hypot(u.x - u.home.x, u.y - u.home.y) > 4) stepToward(world, u, u.home.x, u.home.y, dtMs, 1.6);
  u.hp = Math.min(u.maxHp, u.hp + (u.maxHp * j.regenPctPerSec * dtMs) / 1000);
}

function advanceSpecial(world, u, dtMs) {
  const sp = u.def.special;
  const s = u.special;
  s.t += dtMs;
  if (!s.hit && s.t >= sp.hitMs) {
    s.hit = true;
    const half = (sp.halfAngleDeg * Math.PI) / 180;
    for (const e of world.units) {
      if (e.dead || e.team === 'neutral' || (e.kind !== 'hero' && e.kind !== 'minion') || e.invisible) continue;
      const dx = e.x - u.x;
      const dy = e.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > sp.range + e.radius) continue;
      const cos = d < 0.001 ? 1 : (dx * s.dir.x + dy * s.dir.y) / d;
      const margin = d > e.radius ? Math.asin(Math.min(1, e.radius / d)) : Math.PI;
      if (Math.acos(Math.max(-1, Math.min(1, cos))) <= half + margin) {
        emit(world, { type: 'special_hit', unitId: u.id, targetId: e.id });
        applyDamage(world, u, e, sp.damage);
      }
    }
  }
  if (s.t >= sp.durationMs) u.special = null;
}

/** Appelé à la mort d'un monstre : XP, réapparition du camp, récompense du boss. */
export function onMonsterKilled(world, source, u) {
  const team = source && source.team !== 'neutral' ? source.team : null;
  if (team) awardXp(world, team, u.x, u.y, u.def.xp);
  if (source && source.kind === 'hero') awardGold(world, source, u.def.gold || 0); // or au dernier coup
  if (u.campId) {
    const camp = world.camps.find((c) => c.id === u.campId);
    if (camp.unitIds.every((id) => getUnit(world, id).dead)) camp.respawnAt = world.time + world.match.jungle.respawnMs;
    emit(world, { type: 'camp_cleared', campId: camp.id, team });
  }
  if (u.boss) {
    const b = world.boss;
    b.unitId = null;
    b.spawnAt = world.time + world.match.boss.respawnDelayMs;
    b.announced = false;
    b.announceAt = b.spawnAt - world.match.boss.announceLeadMs;
    emit(world, { type: 'boss_killed', team, killerId: source ? source.id : null });
    if (team) {
      b.kills[team]++;
      // Le joueur crédité (dernier coup) choisit la ligne pendant choiceMs ; sinon choix par défaut.
      const ch = { team, chooserId: source.kind === 'hero' ? source.id : null, expiresAt: world.time + world.match.boss.choiceMs, lane: null };
      world.bonus.choices.push(ch);
      if (!ch.chooserId) resolveBonus(world, ch, world.match.boss.defaultLane, true);
    }
  }
}

function resolveBonus(world, ch, lane, byDefault) {
  ch.lane = lane;
  ch.resolvedAt = world.time;
  world.bonus.pending[ch.team][lane]++;
  emit(world, { type: 'bonus_lane', team: ch.team, lane, byDefault });
}

export function chooseBonusLane(world, heroId, lane) {
  if (!world.match || !world.map.lanes[lane]) return false;
  const ch = world.bonus.choices.find((c) => c.chooserId === heroId && !c.lane);
  if (!ch) return false;
  resolveBonus(world, ch, lane, false);
  return true;
}

/** Sbires supplémentaires pour la prochaine vague de cette équipe sur cette ligne (consomme le bonus). */
export function takeBonusWave(world, team, lane) {
  const p = world.bonus.pending[team];
  if (!p || !p[lane]) return [];
  p[lane]--;
  return world.match.boss.reinforced;
}
