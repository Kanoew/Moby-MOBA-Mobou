import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCamera, CAMERA } from '../src/render/camera.js';
import { createTapDrag } from '../src/input/pointer.js';
import { createWorld, getUnit, step } from '../src/sim/world.js';

const map = { width: 3200, height: 1800 };
const view = { halfW: 800, halfH: 450 }; // écran 16:9, 900 unités de haut (VIEW_H)
const hero = (x, y, extra = {}) => ({ x, y, ...extra });
const run = (cam, ms, args, dt = 16) => {
  let c;
  for (let t = 0; t < ms; t += dt) c = cam.update(dt, { map, view, ...args });
  return c;
};

test('caméra : centrée sur le héros dès la première image, puis suit sans retard excessif en course', () => {
  const cam = createCamera();
  const c0 = cam.update(16, { hero: hero(1600, 900), map, view });
  assert.deepEqual(c0, { x: 1600, y: 900 - CAMERA.yOffset });
  // course à 336 px/s pendant 2 s : le retard reste inférieur à 40 unités (≈ 0,1 s de course)
  const h = hero(1000, 900);
  let c;
  for (let t = 0; t < 2000; t += 16) {
    h.x += (336 * 16) / 1000;
    c = cam.update(16, { hero: h, map, view });
  }
  const lag = h.x - c.x;
  assert.ok(lag >= 0 && lag < 40, `retard ${lag.toFixed(1)}`);
  // à l'arrêt elle rattrape complètement
  c = run(cam, 600, { hero: h });
  assert.ok(Math.abs(c.x - h.x) < 0.5 && Math.abs(c.y - (h.y - CAMERA.yOffset)) < 0.5);
});

test('caméra : un dash (180 px en 200 ms) est rattrapé plus vite que la course normale', () => {
  const cam = createCamera();
  cam.update(16, { hero: hero(1000, 900), map, view });
  const slow = createCamera();
  slow.update(16, { hero: hero(1000, 900), map, view });
  const h1 = hero(1000, 900, { dashing: true });
  const h2 = hero(1000, 900, { dashing: false });
  for (let t = 0; t < 200; t += 16) {
    h1.x += 14; h2.x += 14;
    cam.update(16, { hero: h1, map, view });
    slow.update(16, { hero: h2, map, view });
  }
  assert.ok(h1.x - cam.center().x < h2.x - slow.center().x, 'le dash est suivi de plus près');
});

test('caméra : saut direct après une téléportation (réapparition ou rappel), sans balayage de la carte', () => {
  const cam = createCamera();
  cam.update(16, { hero: hero(2800, 900), map, view });
  const c = cam.update(16, { hero: hero(440, 830), map, view });
  assert.ok(Math.abs(c.x - 800) < 1 || c.x === 800, 'bornée à gauche et déjà arrivée');
  const cam2 = createCamera();
  cam2.update(16, { hero: hero(2400, 900), map, view });
  const c2 = cam2.update(16, { hero: hero(1000, 900), map, view });
  assert.ok(Math.abs(c2.x - 1000) < 1, 'écart de 1 400 : saut');
});

test('caméra : limitée aux dimensions de la carte, même héros contre un bord ou décalage forcé', () => {
  const cam = createCamera();
  let c = run(cam, 400, { hero: hero(50, 50) });
  assert.ok(c.x >= view.halfW && c.y >= view.halfH, `${c.x},${c.y}`);
  c = run(cam, 400, { hero: hero(3150, 1750) });
  assert.ok(c.x <= map.width - view.halfW && c.y <= map.height - view.halfH);
  cam.pan(5000, 5000); // glissé énorme
  c = run(cam, 400, { hero: hero(1600, 900) });
  assert.ok(c.x <= map.width - view.halfW && c.y <= map.height - view.halfH);
  assert.ok(cam.state().offset < 1700, 'le décalage ne s\'accumule pas au-delà des bords');
  // carte plus petite que l'écran : centrée
  const small = createCamera();
  const sc = small.update(16, { hero: hero(100, 100), map: { width: 1000, height: 600 }, view });
  assert.deepEqual(sc, { x: 500, y: 300 });
});

test('caméra : un héros collé au bord de la carte ne crée aucun décalage « fantôme » (pas d\'état libre, pas de retard au retour)', () => {
  const cam = createCamera();
  run(cam, 500, { hero: hero(440, 830) }); // zone de départ alliée : cadre borné à gauche
  assert.equal(cam.state().free, false);
  assert.equal(cam.state().offset, 0);
  cam.pan(-300, 0); // glisser vers le bord déjà atteint n'ajoute rien
  run(cam, 100, { hero: hero(440, 830) });
  assert.equal(cam.state().offset, 0);
  cam.pan(300, 0);
  const c = run(cam, 300, { hero: hero(440, 830) });
  assert.ok(c.x > 800 + 200, 'glisser vers l\'intérieur déplace bien la vue');
  cam.release();
  const back = run(cam, 4000, { hero: hero(440, 830) });
  assert.ok(Math.abs(back.x - 800) < 1 && cam.state().free === false, 'retour complet au cadre borné');
});

test('caméra : glissé = décalage ; au relâchement il reste 1,2 s puis revient progressivement', () => {
  const cam = createCamera();
  const h = hero(1600, 900);
  run(cam, 300, { hero: h });
  cam.pan(300, 0);
  let c = run(cam, 200, { hero: h });
  assert.ok(c.x > 1850, `la vue s'est déplacée : ${c.x.toFixed(0)}`);
  cam.release();
  const held = run(cam, 1000, { hero: h });
  assert.ok(held.x > 1850, 'pendant le délai de 1,2 s la vue reste');
  const mid = run(cam, 600, { hero: h });
  assert.ok(mid.x < held.x && mid.x > 1600 + 5, 'retour progressif en cours');
  const back = run(cam, 2500, { hero: h });
  assert.ok(Math.abs(back.x - 1600) < 1, 'retour complet');
  assert.equal(cam.state().free, false);
});

test('caméra : pendant le glissé le retour ne démarre pas, même au bout de plusieurs secondes', () => {
  const cam = createCamera();
  const h = hero(1600, 900);
  run(cam, 100, { hero: h });
  cam.pan(200, 0);
  const c = run(cam, 4000, { hero: h });
  assert.ok(c.x > 1750);
  assert.equal(cam.state().dragging, true);
});

test('caméra : mode libre maintenu — pas de retour automatique ; sortir du mode lance le retour aussitôt', () => {
  const cam = createCamera();
  const h = hero(1600, 900);
  run(cam, 100, { hero: h });
  cam.pan(-400, 0);
  cam.release();
  assert.equal(cam.toggleHold(), true);
  let c = run(cam, 8000, { hero: h });
  assert.ok(c.x < 1300, 'la vue reste en place 8 s');
  assert.equal(cam.state().held, true);
  assert.equal(cam.toggleHold(), false);
  c = run(cam, 150, { hero: h });
  const c2 = run(cam, 2500, { hero: h });
  assert.ok(c.x < 1590 || c.x > 1300, 'le retour a commencé');
  assert.ok(Math.abs(c2.x - 1600) < 1);
});

test('caméra : recentrage immédiat — décalage effacé, mode libre quitté, héros retrouvé en moins de 0,4 s', () => {
  const cam = createCamera();
  const h = hero(1600, 900);
  run(cam, 100, { hero: h });
  cam.pan(600, -300);
  cam.toggleHold();
  run(cam, 500, { hero: h });
  assert.ok(cam.state().offset > 600);
  cam.recenter();
  assert.deepEqual([cam.state().free, cam.state().held, cam.state().dragging], [false, false, false]);
  const c = run(cam, 400, { hero: h });
  assert.ok(Math.hypot(c.x - 1600, c.y - (900 - CAMERA.yOffset)) < 2, `${c.x},${c.y}`);
});

test('caméra : décalage vers la visée, plafonné et résorbé sans visée ; héros mort : pas de décalage', () => {
  const cam = createCamera();
  const h = hero(1600, 900);
  run(cam, 300, { hero: h });
  const base = cam.center();
  let c = run(cam, 600, { hero: h, aim: { x: 1600 + 300, y: 900 } });
  assert.ok(c.x - base.x > 60 && c.x - base.x <= CAMERA.leadMax + 1, `décalage ${c.x - base.x}`);
  c = run(cam, 600, { hero: h, aim: { x: 1600 + 5000, y: 900 } });
  assert.ok(c.x - base.x <= CAMERA.leadMax + 1, 'plafonné');
  c = run(cam, 800, { hero: h });
  assert.ok(Math.abs(c.x - base.x) < 1, 'résorbé');
  const dead = hero(1600, 900, { dead: true });
  c = run(cam, 600, { hero: dead, aim: { x: 2000, y: 900 } });
  assert.ok(Math.abs(c.x - base.x) < 1);
});

test('caméra : un grand temps de frame (onglet endormi) ne fait pas sauter la vue', () => {
  const cam = createCamera();
  cam.update(16, { hero: hero(1000, 900), map, view });
  const c = cam.update(5000, { hero: hero(1100, 900), map, view });
  assert.ok(c.x <= 1100 && c.x >= 1000);
  const nan = cam.update(NaN, { hero: hero(1100, 900), map, view });
  assert.ok(Number.isFinite(nan.x) && Number.isFinite(nan.y));
});

test('caméra : sans héros (spectateur), centre de la carte, sans erreur', () => {
  const cam = createCamera();
  assert.deepEqual(cam.update(16, { hero: null, map, view }), { x: 1600, y: 900 });
});

/* ------------------------------ appui ou glissé ------------------------------ */

test('appui / glissé : sous le seuil c\'est un appui ; au-delà le glissé rend des déplacements sans saut', () => {
  const t = createTapDrag(10);
  assert.equal(t.down(1, 100, 100), true);
  assert.equal(t.move(1, 104, 103), null, 'dans le seuil');
  assert.equal(t.up(1), 'tap');
  assert.equal(t.down(2, 100, 100), true);
  const a = t.move(2, 130, 100);
  assert.deepEqual(a, { dx: 30, dy: 0, first: true }, 'le premier pas rattrape tout le chemin parcouru');
  const b = t.move(2, 150, 110);
  assert.deepEqual(b, { dx: 20, dy: 10, first: false });
  assert.equal(t.up(2), 'drag');
});

test('appui / glissé : un seul doigt suivi à la fois, les autres sont ignorés', () => {
  const t = createTapDrag(10);
  assert.equal(t.down(1, 0, 0), true);
  assert.equal(t.down(2, 50, 50), false);
  assert.equal(t.move(2, 300, 300), null);
  assert.equal(t.up(2), null);
  assert.equal(t.up(1), 'tap');
  assert.equal(t.down(3, 0, 0), true, 'libre à nouveau');
});

/* ------------------------------ intégration au rendu ------------------------------ */

test('la caméra n\'a aucune influence sur la simulation : même monde, mêmes états avec ou sans glissé', () => {
  const load = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
  const mk = () => createWorld({ map: load('map-3v3.json'), heroDefs: load('heroes.json'), match: load('match.json'), roster: [{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], seed: 1 });
  const w1 = mk();
  const w2 = mk();
  const cam = createCamera();
  for (let i = 0; i < 600; i++) {
    step(w1, 16);
    step(w2, 16);
    cam.pan(10, 0); // la caméra de l'un est secouée en permanence
    cam.update(16, { hero: getUnit(w2, 'a'), map: w2.map, view });
  }
  assert.deepEqual(w1.units.map((u) => [u.id, u.x, u.y, u.hp]), w2.units.map((u) => [u.id, u.x, u.y, u.hp]));
});
