// Jungle : petits camps symétriques, boss au centre exact, récompense de vague renforcée.
import { combatTick, edgeDistance, emit, getUnit, isTargetable, newUnit, stepToward } from './world.js';
import { awardXp } from './progression.js';

const TEAMS = ['ally', 'enemy'];

export function initJungle(world) {
  const { match, map } = world;
  world.camps = [];
  match.jungle.camps.forEach((c, i) => {
    for (const side of TEAMS) {
      // Les camps de l'autre côté sont le miroir exact : mêmes distances d'accès pour les deux équipes.
      const x = side === 'ally' ? c.x : map.width - c.x;
      world.camps.push({ id: `camp-${side}-${i}`, side, x, y: c.y, monsters: c.monsters, unitIds: [], respawnAt: match.jungle.startMs });
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
  Object.assign(u, { monType: type, home: { x, y }, campId, aggroId: null, boss: !!def.boss });
  return u;
}

export function updateJungle(world) {
  const { match } = world;
  for (const camp of world.camps) {
    if (camp.respawnAt !== null && world.time >= camp.respawnAt) {
      camp.respawnAt = null;
      camp.unitIds = camp.monsters.map((type, i) => {
        const off = (i - (camp.monsters.length - 1) / 2) * 70;
        return spawnMonster(world, type, camp.x, camp.y + off, camp.id).id;
      });
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
  if (t) {
    if (u.swing || edgeDistance(u, t) <= u.def.auto.range) combatTick(world, u, t, dtMs);
    else stepToward(world, u, t.x, t.y, dtMs);
    return;
  }
  // Sans cible : retour au point d'attache, soin rapide.
  if (Math.hypot(u.x - u.home.x, u.y - u.home.y) > 4) stepToward(world, u, u.home.x, u.home.y, dtMs, 1.6);
  u.hp = Math.min(u.maxHp, u.hp + (u.maxHp * j.regenPctPerSec * dtMs) / 1000);
}

/** Appelé à la mort d'un monstre : XP, réapparition du camp, récompense du boss. */
export function onMonsterKilled(world, source, u) {
  const team = source && source.team !== 'neutral' ? source.team : null;
  if (team) awardXp(world, team, u.x, u.y, u.def.xp);
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
