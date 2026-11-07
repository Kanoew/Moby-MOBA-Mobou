// Commandes tactiles : joystick flottant (apparaît sous le pouce), boutons d'action, visée au glissement.
// Les fonctions pures (stickVector, aimFromDrag, nearestEnemyInRange) sont testées ; le reste branche le DOM.
import { edgeDistance, isTargetable } from '../sim/world.js';
import { canCast, cooldownLeft } from '../sim/abilities.js';

export const STICK_RADIUS = 56; // px : déplacement maximal du bouton par rapport à son point de départ
export const STICK_DEAD = 0.18; // fraction du rayon sans effet (évite les micro-mouvements)
export const AIM_MIN_DRAG = 14; // px : en dessous, c'est un simple appui (visée automatique)

/** Vecteur de direction du joystick, ou null dans la zone morte. Longueur = 1 (vitesse constante). */
export function stickVector(dx, dy, radius = STICK_RADIUS, dead = STICK_DEAD) {
  const len = Math.hypot(dx, dy);
  if (len < radius * dead) return null;
  return { x: dx / len, y: dy / len };
}

/** Direction de visée pour une compétence glissée depuis son bouton ; null = appui simple. */
export function aimFromDrag(dx, dy, minDrag = AIM_MIN_DRAG) {
  const len = Math.hypot(dx, dy);
  if (len < minDrag) return null;
  return { x: dx / len, y: dy / len };
}

/** Bouton d'attaque : l'ennemi le plus proche à portée d'attaque (bord à bord), ou null. */
export function nearestEnemyInRange(world, hero) {
  let best = null;
  let bestD = Infinity;
  for (const u of world.units) {
    if (!isTargetable(world, hero, u)) continue;
    const d = edgeDistance(hero, u);
    if (d <= hero.def.auto.range && d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

/**
 * Bouton d'attaque (auto-cible) : garde le verrou en cours s'il est valide et pas trop loin ; sinon prend l'ennemi
 * le plus pertinent dans le rayon d'assistance, les héros d'abord, puis sbires et monstres, puis structures.
 * Contrairement à l'ancien comportement, il n'exige plus qu'une cible soit déjà à portée d'attaque.
 */
export function pickAttackTarget(world, hero, radius) {
  const assist = world.match && world.match.attackAssist ? world.match.attackAssist : { radius: 700, maxChase: 900 };
  const R = radius ?? assist.radius;
  const cur = hero.targetId !== null ? world.byId.get(hero.targetId) : null;
  if (cur && isTargetable(world, hero, cur) && Math.hypot(cur.x - hero.x, cur.y - hero.y) <= assist.maxChase) return cur;
  const best = { hero: null, unit: null, structure: null };
  const bestD = { hero: Infinity, unit: Infinity, structure: Infinity };
  for (const u of world.units) {
    if (!isTargetable(world, hero, u)) continue;
    const d = edgeDistance(hero, u);
    if (d > R) continue;
    const k = u.kind === 'hero' ? 'hero' : u.kind === 'tower' || u.kind === 'core' ? 'structure' : 'unit';
    if (d < bestD[k]) {
      best[k] = u;
      bestD[k] = d;
    }
  }
  return best.hero || best.unit || best.structure;
}

/** Action du bouton d'attaque (et de la touche A) : ordre « attaquer » sur la meilleure cible, sinon message. */
export function attackAction(world, hero, issue, notify) {
  const t = pickAttackTarget(world, hero);
  if (t) return issue({ type: 'attack', targetId: t.id });
  if (notify) notify('Aucun ennemi proche');
  return false;
}

/**
 * Cible pour une compétence lancée d'un simple appui : verrou en cours, sinon ennemi le plus proche
 * dans `reach` (centre à centre), sinon la direction du regard.
 */
export function autoAimPoint(world, hero, reach = 480) {
  const t = hero.targetId !== null ? world.byId.get(hero.targetId) : null;
  if (t && isTargetable(world, hero, t)) return { x: t.x, y: t.y };
  let best = null;
  let bestD = reach;
  for (const u of world.units) {
    if (!isTargetable(world, hero, u) || u.kind === 'tower' || u.kind === 'core') continue;
    const d = Math.hypot(u.x - hero.x, u.y - hero.y);
    if (d < bestD) {
      best = u;
      bestD = d;
    }
  }
  if (best) return { x: best.x, y: best.y };
  return { x: hero.x + hero.facing.x * 300, y: hero.y + hero.facing.y * 300 };
}

/* ------------------------------ branchement DOM ------------------------------ */

/**
 * api = { world(), hero(), issue(cmd), setAim(aim|null), enabled() }
 * els = { root, zone, base, knob, attack, skill, ult, plusAttack, plusSkill }
 */
export function bindTouchControls(els, api) {
  // La capture garde le doigt rattaché au bouton même s'il en sort ; sans effet si le navigateur la refuse.
  const capture = (node, id) => {
    try {
      node.setPointerCapture(id);
    } catch {
      /* pointeur déjà relâché */
    }
  };
  // --- Joystick flottant : apparaît là où le pouce se pose dans la zone de gauche ---
  let stickId = null;
  let origin = null;
  const sendStick = (dx, dy) => {
    const v = stickVector(dx, dy);
    api.issue(v ? { type: 'steer', x: v.x, y: v.y } : { type: 'steer', x: 0, y: 0 });
  };
  els.zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null || !api.enabled()) return;
    e.preventDefault();
    stickId = e.pointerId;
    capture(els.zone, e.pointerId);
    const r = els.zone.getBoundingClientRect();
    origin = { x: e.clientX, y: e.clientY };
    els.base.style.left = `${origin.x - r.left}px`;
    els.base.style.top = `${origin.y - r.top}px`;
    els.knob.style.transform = 'translate(-50%, -50%)';
    els.base.classList.add('on');
  });
  els.zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - origin.x;
    let dy = e.clientY - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    els.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    sendStick(dx, dy);
  });
  const release = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    els.base.classList.remove('on');
    api.issue({ type: 'steer', x: 0, y: 0 });
  };
  els.zone.addEventListener('pointerup', release);
  els.zone.addEventListener('pointercancel', release);

  // --- Attaque : auto-cible directe. Verrou en cours, sinon meilleur ennemi proche ; le héros s'en approche ---
  els.attack.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!api.enabled()) return;
    const ok = attackAction(api.world(), api.hero(), api.issue, api.notify);
    els.attack.classList.add(ok ? 'pulse' : 'miss');
    setTimeout(() => els.attack.classList.remove('pulse', 'miss'), 180);
  });

  // --- Compétence : appui = visée automatique ; glisser = viser, relâcher = lancer ---
  let skillId = null;
  let skillStart = null;
  els.skill.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (skillId !== null || !api.enabled()) return;
    const hero = api.hero();
    if (!canCast(api.world(), hero, 'skill')) return;
    skillId = e.pointerId;
    skillStart = { x: e.clientX, y: e.clientY };
    capture(els.skill, e.pointerId);
    els.skill.classList.add('aiming');
  });
  els.skill.addEventListener('pointermove', (e) => {
    if (e.pointerId !== skillId) return;
    const d = aimFromDrag(e.clientX - skillStart.x, e.clientY - skillStart.y);
    const hero = api.hero();
    api.setAim(d ? { slot: 'skill', x: hero.x + d.x * 320, y: hero.y + d.y * 320, fromTouch: true } : null);
  });
  const endSkill = (e, cancel) => {
    if (e.pointerId !== skillId) return;
    const hero = api.hero();
    const d = aimFromDrag(e.clientX - skillStart.x, e.clientY - skillStart.y);
    skillId = null;
    els.skill.classList.remove('aiming');
    api.setAim(null);
    if (cancel) return;
    const p = d ? { x: hero.x + d.x * 320, y: hero.y + d.y * 320 } : autoAimPoint(api.world(), hero);
    api.issue({ type: 'skill', x: p.x, y: p.y });
  };
  els.skill.addEventListener('pointerup', (e) => endSkill(e, false));
  els.skill.addEventListener('pointercancel', (e) => endSkill(e, true));

  // --- Ultime : un appui ---
  els.ult.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (api.enabled()) api.issue({ type: 'ult' });
  });

  // --- Points de compétence ---
  els.plusAttack.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.issue({ type: 'level_up', slot: 'auto' });
  });
  els.plusSkill.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.issue({ type: 'level_up', slot: 'skill' });
  });
}

/** Met à jour l'aspect des boutons (recharge, rang, points) à partir de l'état du jeu. */
export function updateTouchHud(els, world, hero) {
  if (!hero || !world.match) return;
  const setSlot = (btn, slot) => {
    const rank = hero.rank[slot];
    const left = cooldownLeft(world, hero, slot);
    const total = hero.def.abilities[slot].cooldownMs[Math.max(0, rank - 1)];
    btn.classList.toggle('locked', rank < 1);
    btn.classList.toggle('cooling', rank >= 1 && left > 0);
    btn.classList.toggle('ready', rank >= 1 && left === 0 && !hero.cast && !hero.dead);
    btn.style.setProperty('--cd', rank >= 1 && left > 0 ? String(Math.min(1, left / total)) : '0');
    btn.querySelector('.cd-num').textContent = rank >= 1 && left > 0 ? String(Math.ceil(left / 1000)) : '';
    btn.querySelector('.lock-note').textContent = rank < 1 ? (slot === 'skill' ? 'Niv 2' : 'Niv 3') : '';
    btn.dataset.rank = String(rank);
  };
  setSlot(els.skill, 'skill');
  setSlot(els.ult, 'ult');
  els.skill.querySelector('.name').textContent = hero.def.abilities.skill.name;
  els.ult.querySelector('.name').textContent = hero.def.abilities.ult.name;
  els.attack.dataset.rank = String(hero.rank.auto);
  const show = (btn, on) => btn.classList.toggle('show', on);
  show(els.plusAttack, hero.points > 0 && hero.rank.auto < 3);
  show(els.plusSkill, hero.points > 0 && hero.rank.skill < 3);
}
