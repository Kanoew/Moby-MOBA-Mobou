// XP, niveaux 1 à 9, rangs et points de compétence (cahier §2).
//  - Niveau 1 : auto rang 1, donnée automatiquement.
//  - Niveaux 2, 4, 5, 7, 8 : un point à dépenser (auto ou skill, jusqu'au rang 3 chacun).
//  - Niveaux 3, 6, 9 : l'ultime prend le rang 1, 2 puis 3 automatiquement, même si des points restent en attente.
import { emit, getUnit } from './world.js';

export function initProgression(hero, match) {
  hero.level = 1;
  hero.xp = 0;
  hero.points = 0;
  hero.rank = { auto: 1, skill: 0, ult: 0 };
  hero.autoMult = 1;
  hero.base = { hp: hero.maxHp, atk: hero.atk, def: hero.def_ };
  hero.cd = { skill: 0, ult: 0 };
  hero.cast = null;
  hero.shield = null;
  hero.slow = null;
  if (match) applyLevelStats(hero, match, false);
}

export function refreshStats(hero, match) {
  if (match && match.progression) applyLevelStats(hero, match, true);
}

function applyLevelStats(hero, match, keepRatio = true) {
  const g = match.progression.growth;
  const k = hero.level - 1;
  const maxHp = Math.round(hero.base.hp * (1 + g.hp * k)) + (hero.fx ? hero.fx.hp : 0);
  hero.hp = keepRatio ? Math.min(maxHp, hero.hp + (maxHp - hero.maxHp)) : maxHp;
  hero.maxHp = maxHp;
  hero.atk = Math.round(hero.base.atk * (1 + g.atk * k));
  hero.def_ = Math.round(hero.base.def * (1 + g.def * k)) + (hero.fx ? hero.fx.def : 0);
  hero.autoMult = 1 + match.progression.autoRankBonus[hero.rank.auto - 1];
}

export function xpToNext(match, hero) {
  const lv = match.progression.levels;
  return hero.level >= lv.length ? 0 : lv[hero.level] - hero.xp;
}

export function ultRankForLevel(match, level) {
  return match.progression.ultLevels.filter((l) => l <= level).length;
}

export function gainXp(world, hero, amount) {
  const match = world.match;
  if (!match || hero.dead) return;
  hero.xp += amount;
  while (hero.level < match.progression.levels.length && hero.xp >= match.progression.levels[hero.level]) {
    hero.level++;
    if (match.progression.pointLevels.includes(hero.level)) hero.points++;
    hero.rank.ult = ultRankForLevel(match, hero.level);
    applyLevelStats(hero, match);
    emit(world, { type: 'level_up', heroId: hero.id, level: hero.level });
  }
}

/** XP du temps qui passe : chaque héros vivant en gagne `passiveXpPerSec` par seconde. */
export function tickPassiveXp(world, dtMs) {
  const rate = world.match && world.match.progression.passiveXpPerSec;
  if (!rate) return;
  for (const h of world.heroes) {
    if (h.dead) continue;
    h.xpBuffer = (h.xpBuffer || 0) + (rate * dtMs) / 1000;
    if (h.xpBuffer >= 1) {
      const n = Math.floor(h.xpBuffer);
      h.xpBuffer -= n;
      gainXp(world, h, n);
    }
  }
}

/** XP partagée entre les héros vivants de l'équipe qui sont assez proches du lieu de la mort. */
export function awardXp(world, team, x, y, amount) {
  const match = world.match;
  if (!match || !amount) return;
  const near = world.heroes.filter(
    (h) => h.team === team && !h.dead && Math.hypot(h.x - x, h.y - y) <= match.progression.shareRadius,
  );
  if (!near.length) return;
  const share = Math.max(1, Math.round(amount / near.length));
  for (const h of near) gainXp(world, h, share);
}

/** Dépense un point : auto ou skill, jusqu'au rang 3 chacun. */
export function spendPoint(world, heroId, slot) {
  const hero = getUnit(world, heroId);
  const match = world.match;
  if (!match || !hero || hero.kind !== 'hero' || hero.dead) return false;
  if (slot !== 'auto' && slot !== 'skill') return false;
  if (hero.points <= 0 || hero.rank[slot] >= match.progression.maxRank) return false;
  hero.rank[slot]++;
  hero.points--;
  if (slot === 'auto') hero.autoMult = 1 + match.progression.autoRankBonus[hero.rank.auto - 1];
  emit(world, { type: 'rank_up', heroId: hero.id, slot, rank: hero.rank[slot] });
  return true;
}
