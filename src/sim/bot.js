// Bots : n'utilisent que issueCommand, exactement comme le joueur.
// Duel : approche l'ennemi le plus proche. Match : tient une ligne, suit ses sbires, évite les tours
// sans couverture de sbires, se replie à bas PV et revient en jeu après la réapparition.
import { edgeDistance, isTargetable, issueCommand, TEAM_ALLY } from './world.js';

const THINK_MS = 200;
const RESUME_ABOVE = 0.9;

export function updateBot(world, hero, dtMs) {
  if (hero.dead || world.over) return;
  hero.thinkMs -= dtMs;
  if (hero.thinkMs > 0) return;
  hero.thinkMs = THINK_MS;
  if (world.match) matchThink(world, hero);
  else duelThink(world, hero);
}

/* ------------------------------ utilitaires ------------------------------ */

function moveTo(world, hero, p, tol = 90) {
  const cur = hero.moveTarget;
  if (cur) {
    if (Math.hypot(cur.x - p.x, cur.y - p.y) < tol) return;
  } else if (Math.hypot(hero.x - p.x, hero.y - p.y) < 40) return;
  issueCommand(world, hero.id, { type: 'move', x: p.x, y: p.y });
}

function stopIfMoving(world, hero) {
  if (hero.moveTarget) issueCommand(world, hero.id, { type: 'stop' });
}

function lockTarget(world, hero, t) {
  if (hero.targetId !== t.id) issueCommand(world, hero.id, { type: 'target', targetId: t.id });
}

/** Point où s'arrêter pour être à `desired` de bord à bord de la cible. */
function approachPoint(hero, t, desired) {
  const dx = t.x - hero.x;
  const dy = t.y - hero.y;
  const len = Math.hypot(dx, dy) || 1;
  const stopAt = hero.radius + t.radius + desired;
  return { x: t.x - (dx / len) * stopAt, y: t.y - (dy / len) * stopAt };
}

/* --------------------------------- duel --------------------------------- */

function duelThink(world, hero) {
  let best = null;
  let bestD = Infinity;
  for (const e of world.heroes) {
    if (!isTargetable(world, hero, e)) continue;
    const d = edgeDistance(hero, e);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (!best) return;
  lockTarget(world, hero, best);
  const desired = hero.def.auto.range * 0.85;
  if (bestD > desired) moveTo(world, hero, approachPoint(hero, best, desired), 1);
  else stopIfMoving(world, hero);
}

/* --------------------------------- match -------------------------------- */

const progressOf = (world, u) => (u.team === TEAM_ALLY ? u.x : world.map.width - u.x);

function enemyTowers(world, hero) {
  return world.towers.filter((t) => t.team !== hero.team && !t.dead);
}

/** Un sbire allié à portée de la tour : la tour le vise avant le héros. */
function towerHasCover(world, hero, tower) {
  const range = tower.def.auto.range;
  return world.units.some((u) => u.kind === 'minion' && !u.dead && u.team === hero.team && edgeDistance(tower, u) <= range);
}

/** Peut-on se tenir en p sans attirer les tirs d'une tour sans couverture ? */
function safeAt(world, hero, p) {
  for (const tw of enemyTowers(world, hero)) {
    const reach = Math.hypot(p.x - tw.x, p.y - tw.y) - tw.radius - hero.radius;
    if (reach <= tw.def.auto.range + 30 && !towerHasCover(world, hero, tw)) return false;
  }
  return true;
}

function laneMinions(world, hero, lane) {
  return world.units.filter((u) => u.kind === 'minion' && !u.dead && u.team === hero.team && u.lane === lane);
}

function chooseLane(world, hero) {
  if (hero.lane) return hero.lane;
  if (hero.flexLane && world.time < hero.flexUntil) return hero.flexLane;
  const lanes = Object.keys(world.map.lanes);
  let best = lanes[0];
  let bestScore = -Infinity;
  for (const lane of lanes) {
    // Menace : unités ennemies près de nos structures sur cette ligne.
    let threat = 0;
    for (const e of world.units) {
      if (e.dead || e.team === hero.team || (e.kind !== 'minion' && e.kind !== 'hero')) continue;
      if (e.kind === 'minion' && e.lane !== lane) continue;
      if (e.kind === 'hero') {
        const near = world.towers.find((t) => t.team === hero.team && t.lane === lane && !t.dead && Math.hypot(t.x - e.x, t.y - e.y) < 900);
        if (near) threat += 2;
      } else {
        const near = world.towers.find((t) => t.team === hero.team && t.lane === lane && !t.dead && Math.hypot(t.x - e.x, t.y - e.y) < 700);
        if (near) threat += 1;
      }
    }
    // Poussée : on rejoint la ligne où nos sbires sont le plus avancés.
    const ms = laneMinions(world, hero, lane);
    const push = ms.length ? Math.max(...ms.map((m) => progressOf(world, m))) / world.map.width : 0;
    const score = threat * 10 + push;
    if (score > bestScore) {
      best = lane;
      bestScore = score;
    }
  }
  hero.flexLane = best;
  hero.flexUntil = world.time + 4000;
  return best;
}

function anchorFor(world, hero, lane) {
  const ms = laneMinions(world, hero, lane);
  const back = hero.team === TEAM_ALLY ? -110 : 110;
  if (ms.length) {
    const lead = ms.reduce((a, b) => (progressOf(world, b) > progressOf(world, a) ? b : a));
    const p = { x: lead.x + back, y: lead.y };
    if (safeAt(world, hero, p)) return p;
  }
  // Ligne vide : on tient le centre de la ligne, un peu en retrait de notre côté.
  const mid = world.map.lanes[lane].points[Math.floor(world.map.lanes[lane].points.length / 2)];
  const front = { x: mid[0] + back, y: mid[1] };
  if (!ms.length && safeAt(world, hero, front)) return front;
  // Point exposé : on tient la tour la plus avancée de la ligne, un peu en retrait.
  const mine = world.towers.filter((t) => t.team === hero.team && t.lane === lane && !t.dead);
  const tw = mine.find((t) => t.tier === 'outer') || mine.find((t) => t.tier === 'inner');
  if (tw) return { x: tw.x + back, y: tw.y };
  return world.map.spawns[hero.team];
}

function pickTarget(world, hero) {
  const range = hero.def.auto.range;
  const ratio = hero.hp / hero.maxHp;
  const cands = [];
  for (const e of world.units) {
    if (!isTargetable(world, hero, e)) continue;
    const d = edgeDistance(hero, e);
    if (e.kind === 'hero') {
      // On engage un héros si on est en forme, ou s'il est assez faible pour être achevé.
      const weak = e.hp / e.maxHp < 0.35;
      if (d <= range + 250 * hero.aggression && (ratio >= 0.4 || weak) && safeAt(world, hero, e)) cands.push({ e, tier: weak ? -1 : 0, d });
    } else if (e.kind === 'minion') {
      if (d <= range + 250 && safeAt(world, hero, e)) cands.push({ e, tier: 1, d });
    } else if (d <= range + 250 && safeAt(world, hero, e)) {
      cands.push({ e, tier: 2, d });
    }
  }
  if (!cands.length) return null;
  const bestTier = Math.min(...cands.map((c) => c.tier));
  const same = cands.filter((c) => c.tier === bestTier);
  const current = same.find((c) => c.e.id === hero.targetId);
  if (current) return current.e;
  return same.reduce((a, b) => (b.d < a.d ? b : a)).e;
}

function matchThink(world, hero) {
  const spawn = world.map.spawns[hero.team];
  const m = world.match;
  const ratio = hero.hp / hero.maxHp;
  const inBase = Math.hypot(hero.x - spawn.x, hero.y - spawn.y) <= m.spawnZoneRadius;

  // Repli : on rentre se soigner puis on repart à pied.
  if (hero.retreating && ratio >= RESUME_ABOVE && inBase) hero.retreating = false;
  else if (!hero.retreating && ratio < hero.bravery) hero.retreating = true;
  if (hero.retreating) {
    if (hero.targetId !== null) issueCommand(world, hero.id, { type: 'clear_target' });
    moveTo(world, hero, spawn, 60);
    return;
  }

  const target = pickTarget(world, hero);
  if (target) {
    lockTarget(world, hero, target);
    const desired = hero.def.auto.range * 0.88;
    if (edgeDistance(hero, target) > desired) moveTo(world, hero, approachPoint(hero, target, desired), 30);
    else stopIfMoving(world, hero);
    return;
  }

  if (hero.targetId !== null) issueCommand(world, hero.id, { type: 'clear_target' });
  moveTo(world, hero, anchorFor(world, hero, chooseLane(world, hero)));
}
