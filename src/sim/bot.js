// Bots : n'utilisent que issueCommand, exactement comme le joueur.
// Duel : approche l'ennemi le plus proche. Match : tient une ligne, suit ses sbires, évite les tours
// sans couverture de sbires, se replie à bas PV et revient en jeu après la réapparition.
import { edgeDistance, getUnit, isTargetable, issueCommand, otherTeam, TEAM_ALLY } from './world.js';
import { canCast } from './abilities.js';
import { checkBuy, inShopZone, itemDef, sellValue } from './shop.js';

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

/** Menace sur une ligne : unités ennemies proches de nos structures de cette ligne. */
function threatScore(world, hero, lane) {
  let threat = 0;
  for (const e of world.units) {
    if (e.dead || e.team === hero.team || e.team === 'neutral' || (e.kind !== 'minion' && e.kind !== 'hero')) continue;
    if (e.kind === 'minion' && e.lane !== lane) continue;
    const reach = e.kind === 'hero' ? 900 : 700;
    const near = world.towers.find((t) => t.team === hero.team && t.lane === lane && !t.dead && Math.hypot(t.x - e.x, t.y - e.y) < reach);
    if (near) threat += e.kind === 'hero' ? 2 : 1;
  }
  return threat;
}

function chooseLane(world, hero) {
  if (hero.lane) return hero.lane;
  if (hero.flexLane && world.time < hero.flexUntil) return hero.flexLane;
  const lanes = Object.keys(world.map.lanes);
  let best = lanes[0];
  let bestScore = -Infinity;
  for (const lane of lanes) {
    // Poussée : on rejoint la ligne où nos sbires sont le plus avancés.
    const ms = laneMinions(world, hero, lane);
    const push = ms.length ? Math.max(...ms.map((m) => progressOf(world, m))) / world.map.width : 0;
    const score = threatScore(world, hero, lane) * 10 + push;
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
    if (e.team === 'neutral' || !isTargetable(world, hero, e)) continue;
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

/* ------------------------- progression et compétences ------------------------- */

function spendPoints(world, hero) {
  while (hero.points > 0) {
    // Skill d'abord, puis l'auto au rang 2, puis on termine le skill et l'auto.
    const order = hero.rank.skill < 1 ? ['skill'] : hero.rank.auto < 2 ? ['auto', 'skill'] : ['skill', 'auto'];
    if (!order.some((slot) => issueCommand(world, hero.id, { type: 'level_up', slot }))) break;
  }
}

function chooseBonus(world, hero) {
  const ch = world.bonus.choices.find((c) => c.chooserId === hero.id && !c.lane);
  if (!ch) return;
  let best = 'top';
  let bestHp = Infinity;
  for (const lane of Object.keys(world.map.lanes)) {
    const hp = world.towers.filter((t) => t.team === otherTeam(hero.team) && t.lane === lane && !t.dead).reduce((a, t) => a + t.hp, 0);
    if (hp > 0 && hp < bestHp) {
      best = lane;
      bestHp = hp;
    }
  }
  issueCommand(world, hero.id, { type: 'choose_bonus_lane', lane: best });
}

function foesWithin(world, hero, r, kinds = ['hero', 'minion']) {
  return world.units.filter(
    (e) => !e.dead && e.team !== hero.team && e.team !== 'neutral' && kinds.includes(e.kind) && Math.hypot(e.x - hero.x, e.y - hero.y) <= r,
  );
}

/** Compétences : une décision simple par type de capacité. Retourne vrai si un lancer a démarré. */
function tryAbilities(world, hero, target) {
  const ab = hero.def.abilities;
  if (!ab) return false;
  const cast = (slot, p) => issueCommand(world, hero.id, { type: slot, x: p ? p.x : undefined, y: p ? p.y : undefined });

  if (canCast(world, hero, 'ult')) {
    const u = ab.ult;
    if (u.kind === 'slow_zone' && (foesWithin(world, hero, u.radius, ['hero']).length >= 1 || foesWithin(world, hero, u.radius).length >= 3)) return cast('ult');
    if (u.kind === 'thorns' && (foesWithin(world, hero, u.radius * 0.9, ['hero']).length >= 1 || foesWithin(world, hero, u.radius).length >= 3)) return cast('ult');
    if (u.kind === 'shield' && hero.hp / hero.maxHp < 0.7 && foesWithin(world, hero, 520, ['hero']).length >= 1) return cast('ult');
  }
  if (canCast(world, hero, 'skill') && target && target.team !== hero.team) {
    const s = ab.skill;
    const range = s.range[hero.rank.skill - 1];
    const d = edgeDistance(hero, target);
    if (s.kind === 'dash' && target.kind === 'hero' && d > hero.def.auto.range + 40 && d <= range * 0.9) return cast('skill', target);
    if (s.kind === 'fan' && (target.kind === 'hero' || target.kind === 'monster') && d > 160 && d <= range * 0.85) return cast('skill', target);
  }
  return false;
}

/* ------------------------- boutique et rappel ------------------------- */

// Achats dans l'ordre. Le starter s'achète tout de suite (première fois : n'importe où), les gros objets à la base.
const BUILD = {
  yeji: ['lame-courte', 'dague-ouverture', 'gants-duel', 'marteau-siege'],
  sweetie: ['ceinture', 'cuirasse', 'talisman', 'armure-melee'],
  jennie: ['grimoire', 'catalyseur', 'relique', 'sceau'],
};

/** Achète ce qui est possible ; si un passage à la base est utile, lance un rappel. Retourne vrai si un rappel démarre. */
function shopThink(world, hero) {
  if (!world.match.items) return false;
  const want = (BUILD[hero.key] || []).find((id) => !hero.items.includes(id) && !(hero.botSoldStarter && itemDef(world, id).starter));
  if (!want) return false;
  const it = itemDef(world, want);
  const zone = inShopZone(world, hero);
  const r = checkBuy(world, hero, want);
  if (r.ok) {
    issueCommand(world, hero.id, { type: 'buy', itemId: want });
    return false;
  }
  // Inventaire plein : on revend le starter pour acheter le gros objet suivant.
  const starter = hero.items.map((id) => (id ? itemDef(world, id) : null)).find((x) => x && x.starter);
  const canAfford = (extra) => hero.gold + extra >= it.priceGold;
  if (r.reason === 'Inventaire plein' && starter && canAfford(sellValue(world, starter))) {
    if (zone) {
      hero.botSoldStarter = true;
      issueCommand(world, hero.id, { type: 'sell', itemId: starter.id });
      issueCommand(world, hero.id, { type: 'buy', itemId: want });
      return false;
    }
    return goRecall(world, hero);
  }
  if (r.reason === 'Retour à la base' && canAfford(0)) return goRecall(world, hero);
  return false;
}

function goRecall(world, hero) {
  if (hero.retreating || foesWithin(world, hero, 900).length) return false;
  return issueCommand(world, hero.id, { type: 'recall' });
}

/* ------------------------- jungle et boss ------------------------- */

function liveMonsters(world, pred) {
  return world.units.filter((u) => u.kind === 'monster' && !u.dead && pred(u));
}

function objectiveFor(world, hero) {
  const m = world.match;
  if (!m.jungle || world.time < m.jungle.startMs || hero.hp / hero.maxHp < 0.6) return null;
  const anyThreat = Object.keys(world.map.lanes).some((lane) => threatScore(world, hero, lane) > 0);
  if (anyThreat) return null;

  // Boss : le héros flottant et celui de la ligne du bas, si les deux sont en forme et si le boss est à prendre.
  const boss = world.boss && world.boss.unitId ? getUnit(world, world.boss.unitId) : null;
  if (boss && !boss.dead && (hero.lane === null || hero.lane === 'bottom')) {
    const mates = world.heroes.filter((h) => h.team === hero.team && !h.dead && (h.lane === null || h.lane === 'bottom'));
    const ready = mates.length >= 2 && mates.every((h) => h.hp / h.maxHp >= 0.6);
    const rivals = world.heroes.filter((h) => h.team !== hero.team && !h.dead && Math.hypot(h.x - boss.x, h.y - boss.y) < 800).length;
    if (ready && rivals <= 1) return boss;
  }
  // Camps : seulement pour le héros flottant.
  if (hero.lane === null) {
    const mons = liveMonsters(world, (u) => u.campId && world.camps.find((c) => c.id === u.campId).side === hero.team);
    if (mons.length) return mons.reduce((a, b) => (Math.hypot(b.x - hero.x, b.y - hero.y) < Math.hypot(a.x - hero.x, a.y - hero.y) ? b : a));
  }
  return null;
}

function matchThink(world, hero) {
  const spawn = world.map.spawns[hero.team];
  const m = world.match;
  const ratio = hero.hp / hero.maxHp;
  const inBase = Math.hypot(hero.x - spawn.x, hero.y - spawn.y) <= m.spawnZoneRadius;

  spendPoints(world, hero);
  chooseBonus(world, hero);
  if (hero.cast || hero.recall) return; // lancer ou danse de rappel en cours
  if (shopThink(world, hero)) return;

  // Repli : on rentre se soigner puis on repart à pied.
  if (hero.retreating && ratio >= RESUME_ABOVE && inBase) hero.retreating = false;
  else if (!hero.retreating && (ratio < hero.bravery || (ratio < 0.55 && foesWithin(world, hero, 900).length === 0))) hero.retreating = true; // blessé et au calme : on remonte se soigner
  if (hero.retreating) {
    if (hero.targetId !== null) issueCommand(world, hero.id, { type: 'clear_target' });
    // Une dernière arme avant de partir : le bouclier se lance aussi en fuite.
    tryAbilities(world, hero, null);
    // Loin de la base et à l'abri : on se rappelle plutôt que de marcher.
    if (!inBase && Math.hypot(hero.x - spawn.x, hero.y - spawn.y) > 700 && foesWithin(world, hero, 800).length === 0 && issueCommand(world, hero.id, { type: 'recall' })) return;
    moveTo(world, hero, spawn, 60);
    return;
  }

  let target = pickTarget(world, hero);
  const objective = objectiveFor(world, hero);
  if (objective && !(target && target.kind === 'hero')) target = objective;

  if (tryAbilities(world, hero, target)) return;

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
