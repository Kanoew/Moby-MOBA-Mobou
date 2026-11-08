// Lot 2 du plan d'amélioration : réactivité des déplacements et des attaques.
// Vérifie les transitions déplacement ↔ attaque ↔ compétence ↔ dash pour chaque héros, le filtre du joystick
// et l'interpolation visuelle. Aucune valeur d'équilibrage n'est modifiée par ce lot : les tests la lisent dans les données.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDamage, createWorld, getUnit, issueCommand, step } from '../src/sim/world.js';
import { gainXp } from '../src/sim/progression.js';
import { createStickFilter, stickVector, STICK_DEAD, STICK_RADIUS, STICK_RELEASE } from '../src/ui/touch.js';
import { alphaOf, applyInterpolation, snapshot, INTERP } from '../src/render/interp.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const map = load('map-3v3.json');
const heroDefs = load('heroes.json');
const match = { ...load('match.json'), items: load('items.json') };
const DT = 16;

function mk(hero = 'yeji') {
  const w = createWorld({ map, heroDefs, match, roster: [{ id: 'a', hero, team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], seed: 1 });
  w.log = [];
  w.onEvent = (e) => w.log.push(e);
  return w;
}
const run = (w, ms) => { for (let t = 0; t < ms; t += DT) step(w, DT); };
const place = (u, x, y) => { u.x = x; u.y = y; };
/** Ennemi factice très résistant, immobile, qui n'attaque pas : on mesure les coups reçus. */
function dummy(w, x, y) {
  w.pendingSpawns.push({ at: 0, team: 'enemy', lane: 'top', type: 'gnome' });
  run(w, DT);
  const m = [...w.units].reverse().find((u) => u.kind === 'minion' && u.team === 'enemy');
  m.hp = m.maxHp = 1e7;
  m.speed = 0;
  m.def = { ...m.def, ai: { aggro: 0, leash: 0 } };
  m.atk = 0;
  place(m, x, y);
  return m;
}
const hits = (w, id = 'a') => w.log.filter((e) => e.type === 'damage' && e.sourceId === id).length;
const hitTimes = (w, id = 'a') => w.log.filter((e) => e.type === 'damage' && e.sourceId === id).map((e) => e.t);
/** Héros en ligne, sorti de sa zone de départ, face à un ennemi factice à portée. */
function setup(hero) {
  const w = mk(hero);
  run(w, 5200);
  const a = getUnit(w, 'a');
  place(a, 1500, 450);
  const range = a.def.auto.range;
  const foe = dummy(w, 1500 + a.radius + range * 0.6 + 20, 450);
  issueCommand(w, 'a', { type: 'target', targetId: foe.id });
  return { w, a, foe, auto: a.def.auto, t: a.timing };
}
const HEROES = ['yeji', 'sweetie', 'jennie'];

/* ------------------------------ interruptions par le joystick ------------------------------ */

for (const hero of HEROES) {
  test(`${hero} : déplacement avant l'impact = coup annulé sans consommer la cadence ; relâché, le coup repart aussitôt`, () => {
    const { w, a, foe, t } = setup(hero);
    run(w, 40); // le coup démarre
    assert.ok(a.swing && !a.swing.hitDone, 'coup en préparation');
    const next = a.nextAttackAt;
    issueCommand(w, 'a', { type: 'steer', x: 0, y: -1 });
    assert.equal(a.swing, null, 'annulé');
    assert.ok(a.nextAttackAt < next, 'la cadence est rendue');
    issueCommand(w, 'a', { type: 'steer', x: 0, y: 0 });
    run(w, DT * 2);
    assert.ok(a.swing, 'un nouveau coup démarre sans attendre un intervalle complet');
    assert.equal(foe.hp, foe.maxHp, 'aucun dégât pour le coup annulé');
    assert.ok(t.hitMs > 0);
  });

  test(`${hero} : déplacement après l'impact = dégâts conservés, récupération coupée, cadence intacte, reprise immédiate`, () => {
    const { w, a, foe, auto, t } = setup(hero);
    // attendre l'impact
    for (let i = 0; i < 100 && !(a.swing && a.swing.hitDone); i++) run(w, DT);
    assert.ok(a.swing && a.swing.hitDone, 'impact passé');
    const start = hitTimes(w)[0] ?? w.time;
    const nextAt = a.nextAttackAt;
    issueCommand(w, 'a', { type: 'steer', x: 0, y: -1 });
    assert.equal(a.swing, null, 'récupération coupée : le héros peut bouger tout de suite');
    assert.equal(a.nextAttackAt, nextAt, 'la cadence est conservée');
    run(w, 200);
    assert.ok(a.y < 450, 'il s\'éloigne');
    // revenir et reprendre : jamais plus d'un coup par intervalle
    issueCommand(w, 'a', { type: 'steer', x: 0, y: 0 });
    place(a, 1500, 450);
    run(w, 4000);
    const times = hitTimes(w);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= auto.intervalMs - DT, `intervalle ${times[i] - times[i - 1]} ms`);
    assert.ok(times.length >= 3, 'les coups reprennent');
    assert.ok(foe.hp < foe.maxHp && start >= 0);
  });

  test(`${hero} : un joystick qui bouge sans cesse ne peut pas faire plus de coups que la cadence (pas de coup « gratuit »)`, () => {
    const { w, a, auto } = setup(hero);
    const t0 = w.time;
    for (let i = 0; i < 220; i++) {
      // 3,5 s : un pas de 96 ms dans une direction, un pas à l'arrêt, en alternance, en revenant à portée
      if (i % 12 === 0) { issueCommand(w, 'a', { type: 'steer', x: 0, y: i % 24 === 0 ? -1 : 1 }); }
      if (i % 12 === 6) { issueCommand(w, 'a', { type: 'steer', x: 0, y: 0 }); place(a, 1500, 450); }
      run(w, DT);
    }
    const n = hits(w);
    assert.ok(n <= Math.ceil((w.time - t0) / auto.intervalMs) + 1, `${n} coups`);
  });
}

/* ------------------------------ compétences, dash, commandes mémorisées ------------------------------ */

for (const hero of HEROES) {
  test(`${hero} : compétence pendant le coup = coup annulé (cadence rendue) ; après le lancer, les autos reprennent sur la cible`, () => {
    const { w, a, foe } = setup(hero);
    gainXp(w, a, match.progression.levels[1] - a.xp);
    issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
    run(w, 40);
    assert.ok(a.swing && !a.swing.hitDone);
    issueCommand(w, 'a', { type: 'skill', x: 1500 + 300, y: 450 });
    assert.ok(a.cast, 'lancer en cours');
    assert.equal(a.swing, null);
    run(w, 2500);
    assert.equal(a.cast, null);
    assert.equal(a.targetId, foe.id, 'verrou conservé');
    run(w, 2000);
    assert.ok(hits(w) >= 2, 'les autos reprennent');
  });

  test(`${hero} : joystick tenu pendant un lancer = le déplacement reprend dès la fin du lancer (au plus un pas perdu)`, () => {
    const { w, a } = setup(hero);
    gainXp(w, a, match.progression.levels[1] - a.xp);
    issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
    issueCommand(w, 'a', { type: 'clear_target' });
    place(a, 1000, 450);
    issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 });
    run(w, 200);
    issueCommand(w, 'a', { type: 'skill', x: 1300, y: 450 });
    assert.ok(a.cast);
    let castEnd = -1;
    for (let i = 0; i < 400 && castEnd < 0; i++) {
      run(w, DT);
      if (!a.cast) castEnd = i;
    }
    assert.ok(castEnd >= 0, 'le lancer se termine');
    const x0 = a.x;
    run(w, DT);
    run(w, DT);
    assert.ok(a.x > x0 + 1, 'il avance dès les deux pas suivants');
    assert.ok(a.steer, 'direction du joystick retrouvée');
  });

  test(`${hero} : joystick relâché pendant un lancer = le héros s'arrête à la fin du lancer, sans glisser`, () => {
    const { w, a } = setup(hero);
    gainXp(w, a, match.progression.levels[1] - a.xp);
    issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
    issueCommand(w, 'a', { type: 'clear_target' });
    place(a, 1000, 450);
    issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 });
    run(w, 100);
    issueCommand(w, 'a', { type: 'skill', x: 1300, y: 450 });
    run(w, 3 * DT);
    issueCommand(w, 'a', { type: 'steer', x: 0, y: 0 }); // le pouce se lève pendant le lancer
    run(w, 3000);
    const x = a.x;
    run(w, 400);
    assert.equal(a.x, x, 'immobile');
    assert.equal(a.steer, null);
  });
}

test('Yeji : un dash suivi d\'un ordre de déplacement (clic) donné pendant le dash est exécuté à la fin, une seule fois', () => {
  const { w, a } = setup('yeji');
  gainXp(w, a, match.progression.levels[1] - a.xp);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  issueCommand(w, 'a', { type: 'clear_target' });
  place(a, 1000, 450);
  issueCommand(w, 'a', { type: 'skill', x: 1300, y: 450 });
  run(w, 3 * DT);
  assert.ok(a.dashing || a.cast);
  issueCommand(w, 'a', { type: 'move', x: 1000, y: 650 });
  issueCommand(w, 'a', { type: 'move', x: 1000, y: 250 }); // la dernière intention gagne
  run(w, 2000);
  assert.equal(a.cast, null);
  assert.ok(Math.abs(a.y - 250) < 30, `y = ${a.y}`);
});

test('projectile de Jennie : une fois parti il touche même si le héros bouge aussitôt ; l\'impact reste à 240 ms', () => {
  const { w, a, foe, t } = setup('jennie');
  assert.equal(t.hitMs, 240);
  for (let i = 0; i < 40 && !w.log.some((e) => e.type === 'spawn_projectile'); i++) run(w, DT);
  assert.ok(w.log.some((e) => e.type === 'spawn_projectile'), 'projectile parti');
  issueCommand(w, 'a', { type: 'steer', x: 0, y: -1 });
  run(w, 800);
  assert.ok(foe.hp < foe.maxHp, 'dégâts reçus malgré le déplacement');
  assert.equal(hits(w), 1);
});

/* ------------------------------ joystick : filtre ------------------------------ */

test('joystick : hystérésis — un pouce qui tremble autour du seuil ne fait pas alterner bouge / immobile', () => {
  const f = createStickFilter();
  const dead = STICK_RADIUS * STICK_DEAD;
  const rel = STICK_RADIUS * STICK_RELEASE;
  assert.ok(rel < dead);
  const sent = [];
  // tremblement entre 0,15 et 0,22 du rayon, autour du seuil de 0,18
  for (let i = 0; i < 40; i++) {
    const r = STICK_RADIUS * (i % 2 ? 0.22 : 0.15);
    const out = f.update(r, 0);
    if (out.send) sent.push(out.vector ? 'go' : 'stop');
  }
  assert.deepEqual(sent, ['go'], 'engagé une seule fois, jamais relâché par le tremblement');
  // relâcher franchement
  assert.deepEqual(f.update(0, 0), { send: true, vector: null });
  assert.deepEqual(f.update(0, 0), { send: false, vector: null }, 'pas de renvoi de l\'arrêt');
  // la zone morte d'origine reste celle de départ
  assert.equal(stickVector(STICK_RADIUS * 0.17, 0), null);
});

test('joystick : on ne renvoie pas la même direction, mais un vrai changement de direction passe tout de suite', () => {
  const f = createStickFilter();
  assert.equal(f.update(50, 0).send, true);
  assert.equal(f.update(50, 0.4).send, false, 'moins d\'un degré');
  assert.equal(f.update(51, 0.2).send, false);
  const out = f.update(40, 30);
  assert.equal(out.send, true);
  assert.ok(Math.abs(out.vector.x - 0.8) < 1e-9 && Math.abs(out.vector.y - 0.6) < 1e-9);
  f.reset();
  assert.equal(f.engaged(), false);
  assert.equal(f.update(50, 0).send, true, 'après un reset on renvoie');
});

/* ------------------------------ interpolation visuelle ------------------------------ */

test('interpolation : fraction du pas bornée, valeurs absurdes sans effet', () => {
  assert.equal(alphaOf(8, 16), 0.5);
  assert.equal(alphaOf(-3, 16), 0);
  assert.equal(alphaOf(40, 16), 1);
  assert.equal(alphaOf(NaN, 16), 1);
  assert.equal(alphaOf(5, 0), 1);
});

test('interpolation : les positions affichées sont entre l\'ancienne et la nouvelle, puis les vraies sont restituées à l\'identique', () => {
  const w = mk('yeji');
  run(w, 5200);
  const a = getUnit(w, 'a');
  issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 });
  run(w, 100);
  snapshot(w);
  const before = a.x;
  step(w, DT);
  const real = { x: a.x, y: a.y };
  assert.ok(real.x > before);
  const restore = applyInterpolation(w, 0.5);
  assert.ok(Math.abs(a.x - (before + real.x) / 2) < 1e-9);
  restore();
  assert.deepEqual({ x: a.x, y: a.y }, real, 'positions de simulation restituées');
  const none = applyInterpolation(w, 1);
  assert.equal(a.x, real.x);
  none();
});

test('interpolation : pas de glissement après une téléportation, ni pour une unité sans position précédente', () => {
  const w = mk('yeji');
  run(w, 5200);
  const a = getUnit(w, 'a');
  snapshot(w);
  place(a, a.x + INTERP.maxJump + 400, a.y); // réapparition, rappel…
  const x = a.x;
  const restore = applyInterpolation(w, 0.3);
  assert.equal(a.x, x, 'saut non lissé');
  restore();
  const fresh = { x: 10, y: 10 };
  w.units.push({ ...a, id: 'zz', x: 50, y: 50 });
  const r2 = applyInterpolation(w, 0.3);
  assert.equal(w.units.find((u) => u.id === 'zz').x, 50, 'sans px : inchangé');
  r2();
  assert.ok(fresh);
});

test('interpolation : le dessin ne modifie jamais la simulation (même état avec ou sans appels d\'interpolation)', () => {
  const w1 = mk('yeji');
  const w2 = mk('yeji');
  for (let i = 0; i < 700; i++) {
    if (i === 340) { issueCommand(w1, 'a', { type: 'steer', x: 1, y: 0.3 }); issueCommand(w2, 'a', { type: 'steer', x: 1, y: 0.3 }); }
    snapshot(w2);
    step(w1, DT);
    step(w2, DT);
    const restore = applyInterpolation(w2, (i % 7) / 7);
    restore();
  }
  const sig = (w) => JSON.stringify(w.units.map((u) => [u.id, u.x, u.y, u.hp]));
  assert.equal(sig(w1), sig(w2));
});

test('interpolation : à toutes les cadences d\'écran la position affichée avance régulièrement (60, 90, 120, 144 Hz)', () => {
  for (const hz of [60, 90, 120, 144]) {
    const w = mk('yeji');
    run(w, 5200);
    const a = getUnit(w, 'a');
    place(a, 600, 450);
    issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 });
    const frame = 1000 / hz;
    let acc = 0;
    const shown = [];
    for (let f = 0; f < hz * 2; f++) {
      acc += frame;
      while (acc >= DT) { snapshot(w); step(w, DT); acc -= DT; }
      const restore = applyInterpolation(w, alphaOf(acc, DT));
      shown.push(a.x);
      restore();
    }
    const d = shown.slice(10).map((v, i, arr) => (i ? v - arr[i - 1] : null)).slice(1);
    const spread = Math.max(...d) - Math.min(...d);
    assert.ok(spread < 0.05, `${hz} Hz : écart ${spread.toFixed(3)} px entre images`);
    assert.ok(d.every((v) => v > 0), `${hz} Hz : aucune image immobile`);
  }
});

/* ------------------------------ glissement le long des obstacles (joystick) ------------------------------ */

const calm = { ...match, waves: { ...match.waves, firstMs: 1e9 }, jungle: { ...match.jungle, startMs: 1e9 } };
function slideSpeed(hero, obstacle, biasDeg) {
  const w = createWorld({ map, heroDefs, match: calm, roster: [{ id: 'a', hero, team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], seed: 1 });
  run(w, 5200);
  const a = getUnit(w, 'a');
  a.x = obstacle.x - obstacle.w / 2 - 260;
  a.y = obstacle.y;
  const rad = (biasDeg * Math.PI) / 180;
  issueCommand(w, 'a', { type: 'steer', x: Math.cos(rad), y: Math.sin(rad) });
  for (let i = 0; i < 200; i++) {
    const x = a.x;
    const y = a.y;
    step(w, DT);
    if (Math.hypot(a.x - x, a.y - y) < 5.3) break; // au contact
  }
  const p0 = { x: a.x, y: a.y };
  let inside = false;
  for (let i = 0; i < 60; i++) {
    step(w, DT);
    const cx = Math.min(obstacle.x + obstacle.w / 2, Math.max(obstacle.x - obstacle.w / 2, a.x));
    const cy = Math.min(obstacle.y + obstacle.h / 2, Math.max(obstacle.y - obstacle.h / 2, a.y));
    if (Math.hypot(a.x - cx, a.y - cy) < a.radius - 0.01) inside = true;
  }
  return { v: Math.hypot(a.x - p0.x, a.y - p0.y) / (60 * DT / 1000), max: a.def.stats.speed, inside };
}
const WALL = { x: 1350, y: 900, w: 70, h: 160 }; // un des deux murs plats du centre de la carte

for (const hero of HEROES) {
  test(`${hero} : contre un mur plat, le joystick glisse à au moins 70 % de la vitesse dès 3° de biais (avant : 5 %)`, () => {
    for (const bias of [3, 6, 10, 20]) {
      const r = slideSpeed(hero, WALL, bias);
      assert.ok(r.v >= 0.7 * r.max, `${hero} ${bias}° : ${Math.round(r.v)} px/s sur ${r.max}`);
      assert.equal(r.inside, false, 'jamais dans l\'obstacle');
    }
  });
}

test('de face contre un mur, le joystick arrête le héros (aucun glissement parasite) ; un clic contourne toujours par A*', () => {
  const r = slideSpeed('yeji', WALL, 0);
  assert.ok(r.v < 20, `${Math.round(r.v)} px/s`);
  const w = createWorld({ map, heroDefs, match: calm, roster: [{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], seed: 1 });
  run(w, 5200);
  const a = getUnit(w, 'a');
  place(a, 1100, 900);
  issueCommand(w, 'a', { type: 'move', x: 1600, y: 900 });
  run(w, 3000);
  assert.ok(Math.abs(a.x - 1600) < 40 && Math.abs(a.y - 900) < 40, `${a.x},${a.y}`);
});
