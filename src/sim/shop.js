// Or, inventaire et effets des douze objets (cahier §3). Le catalogue vit dans data/items.json (world.match.items).
//  - 3 emplacements, un exemplaire par objet.
//  - Le premier achat de starter se fait où l'on veut (ligne ou jungle) et consomme cette possibilité, même fait à la base.
//  - Tout autre achat et toute vente : héros vivant dans la zone de boutique (sa zone de départ).
//  - Un achat est atomique : or et inventaire changent ensemble ; un double appui ne débite qu'une fois.
import { emit } from './world.js';
import { refreshStats } from './progression.js';

export function emptyFx() {
  return { atk: 0, autoFlat: 0, opener: null, duel: null, structure: 0, hp: 0, def: 0, talisman: null, armor: null, grimoire: 0, cdReduction: 0, ultBonus: 0, seal: 0 };
}

export const catalog = (world) => (world.match && world.match.items ? world.match.items : null);
export const itemDef = (world, id) => {
  const c = catalog(world);
  return c ? c.items.find((i) => i.id === id) || null : null;
};
export const sellValue = (world, it) => Math.floor(it.priceGold * catalog(world).rules.sellPriceRatio);

export function inShopZone(world, hero) {
  const sp = world.map.spawns[hero.team];
  return Math.hypot(hero.x - sp.x, hero.y - sp.y) <= world.match.economy.shopRadius;
}

export function startingGold(match) {
  return match && match.items ? match.items.rules.startingGold : 0;
}

export function awardGold(world, hero, amount) {
  if (!hero || hero.kind !== 'hero' || !amount || !world.match) return;
  hero.gold += amount;
  emit(world, { type: 'gold', heroId: hero.id, amount });
}

/** Qu'est-ce qui empêche cet achat ? Retourne { ok, reason } ; `reason` est le libellé affiché au joueur. */
export function checkBuy(world, hero, itemId) {
  const cat = catalog(world);
  const it = itemDef(world, itemId);
  if (!cat || !it) return { ok: false, reason: 'Objet inconnu' };
  if (hero.dead) return { ok: false, reason: 'Héros éliminé' };
  if (hero.items.includes(itemId)) return { ok: false, reason: 'Déjà équipé' };
  const freeStarter = it.starter && !hero.starterBought;
  if (!freeStarter && !inShopZone(world, hero)) return { ok: false, reason: 'Retour à la base' };
  if (!hero.items.includes(null)) return { ok: false, reason: 'Inventaire plein' };
  if (hero.gold < it.priceGold) return { ok: false, reason: 'Or insuffisant' };
  return { ok: true, reason: '' };
}

export function buyItem(world, hero, itemId) {
  const r = checkBuy(world, hero, itemId);
  if (!r.ok) {
    emit(world, { type: 'shop_denied', heroId: hero.id, itemId, reason: r.reason });
    return r;
  }
  const it = itemDef(world, itemId);
  // Or et inventaire changent ensemble.
  hero.gold -= it.priceGold;
  hero.items[hero.items.indexOf(null)] = itemId;
  if (it.starter) hero.starterBought = true; // même acheté à la base : la possibilité hors zone est consommée
  recomputeItems(world, hero);
  emit(world, { type: 'item_bought', heroId: hero.id, itemId, price: it.priceGold });
  return r;
}

export function checkSell(world, hero, itemId) {
  const it = itemDef(world, itemId);
  if (!it) return { ok: false, reason: 'Objet inconnu' };
  if (hero.dead) return { ok: false, reason: 'Héros éliminé' };
  if (!hero.items.includes(itemId)) return { ok: false, reason: 'Objet non possédé' };
  if (!inShopZone(world, hero)) return { ok: false, reason: 'Retour à la base' };
  return { ok: true, reason: '' };
}

export function sellItem(world, hero, itemId) {
  const r = checkSell(world, hero, itemId);
  if (!r.ok) {
    emit(world, { type: 'shop_denied', heroId: hero.id, itemId, reason: r.reason });
    return r;
  }
  const it = itemDef(world, itemId);
  const gain = sellValue(world, it);
  hero.items[hero.items.indexOf(itemId)] = null;
  hero.gold += gain;
  recomputeItems(world, hero);
  emit(world, { type: 'item_sold', heroId: hero.id, itemId, gain });
  return r;
}

/** Recalcule les effets agrégés des objets possédés, puis les statistiques (PV max, Défense). */
export function recomputeItems(world, hero) {
  const fx = emptyFx();
  for (const id of hero.items) {
    const it = id ? itemDef(world, id) : null;
    if (!it) continue;
    fx.atk += it.stats?.attack || 0;
    const e = it.effect;
    switch (e.type) {
      case 'basicAttackBonus': fx.autoFlat += e.flatDamage; break;
      case 'openingBasicAttack': fx.opener = e; break;
      case 'sameTargetBasicAttack': fx.duel = e; break;
      case 'structureBasicAttackBonus': fx.structure += e.bonusRatio; break;
      case 'maxHealthBonus': fx.hp += e.flatHealth; break;
      case 'defenseBonus': fx.def += e.flatDefense; break;
      case 'lowHealthShield': fx.talisman = e; break;
      case 'multiAttackerDefense': fx.armor = e; break;
      case 'offensiveSkillBonus': fx.grimoire += e.flatDamage; break;
      case 'skillCooldownReduction': fx.cdReduction += e.reductionRatio; break;
      case 'ultimatePrimaryValueBonus': fx.ultBonus += e.bonusRatio; break;
      case 'skillHitCooldownRefund': fx.seal = e.remainingReductionRatio; break;
      default: break;
    }
  }
  hero.fx = fx;
  refreshStats(hero, world.match);
}

/* ------------------------------ effets en combat ------------------------------ */

/** Dégâts bruts d'une auto de héros : Attaque × rang, + bonus d'objets. Met à jour le compteur de la même cible. */
export function heroAutoDamage(world, hero, target) {
  const fx = hero.fx;
  let raw = hero.atk * hero.autoMult + fx.autoFlat;
  // Dague d'ouverture : première auto après une pause de combat (dégâts donnés ou reçus).
  if (fx.opener && world.time - hero.lastCombatAt >= fx.opener.outOfCombatMs) raw += fx.opener.flatDamage;
  // Gants de duel : chaque troisième auto consécutive sur la même cible.
  if (hero.duel.targetId === target.id) hero.duel.count++;
  else {
    hero.duel.targetId = target.id;
    hero.duel.count = 1;
  }
  if (fx.duel && hero.duel.count % fx.duel.hitCount === 0) raw += fx.duel.flatDamage;
  // Marteau de siège : bonus contre les tours.
  if (fx.structure && target.kind === 'tower') raw *= 1 + fx.structure;
  return raw;
}

/** Défense effective : niveau + objets + bonus temporaire (Armure de mêlée). */
export function effectiveDefense(world, unit) {
  return unit.def_ + (unit.defBuff && world.time < unit.defBuff.until ? unit.defBuff.amount : 0);
}

/** Réactions des objets à un coup reçu par un héros (Talisman, Armure de mêlée). */
export function onHeroDamaged(world, hero, source, hpBefore) {
  const fx = hero.fx;
  if (fx.talisman) {
    const t = fx.talisman;
    if (hero.hp > 0 && hpBefore / hero.maxHp >= t.thresholdHealthRatio && hero.hp / hero.maxHp < t.thresholdHealthRatio && world.time >= hero.talismanReadyAt) {
      hero.talismanReadyAt = world.time + t.cooldownMs;
      const amount = t.flatShield + (hero.shield ? hero.shield.amount : 0);
      hero.shield = { amount, max: amount, since: world.time, until: world.time + t.durationMs };
      emit(world, { type: 'talisman', heroId: hero.id, amount: t.flatShield });
    }
  }
  if (fx.armor && source && source.kind === 'hero' && source.team !== hero.team) {
    const a = fx.armor;
    hero.attackers[source.id] = world.time;
    const recent = Object.values(hero.attackers).filter((t) => world.time - t <= a.triggerWindowMs).length;
    if (recent >= a.uniqueEnemyHeroCount && world.time >= hero.armorReadyAt) {
      hero.armorReadyAt = world.time + a.cooldownMs;
      hero.defBuff = { amount: a.flatDefense, until: world.time + a.durationMs };
      emit(world, { type: 'armor', heroId: hero.id, amount: a.flatDefense });
    }
  }
}
