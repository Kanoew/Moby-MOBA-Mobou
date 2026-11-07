import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickSprite, frameAt } from '../src/render/animator.js';

const heroDefs = JSON.parse(readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8'));
const hero = (key, over = {}) => ({ def: heroDefs[key], facing: { x: 1, y: 0 }, swing: null, cast: null, moveTarget: null, targetId: null, ...over });

test('lancer : images de la planche de compétence, une direction par ligne (Yeji)', () => {
  const dirs = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, front: { x: 0, y: 1 }, back: { x: 0, y: -1 } };
  const rows = { right: 0, left: 1, front: 2, back: 3 };
  for (const [name, f] of Object.entries(dirs)) {
    const s = pickSprite(hero('yeji', { facing: f, cast: { slot: 'skill', t: 100 } }), 0);
    assert.equal(s.sheet, 'assets/yeji/dash.png');
    assert.equal(s.sy, rows[name] * 640);
    assert.equal(s.sx, 1 * 640, 'image 1 à 100 ms (80 + 50)');
  }
});

test('lancer : instants des images (Yeji dash : 80, 50, 55, 65, 90, 110)', () => {
  const d = heroDefs.yeji.sprites.abilities.skill.frameDurationsMs;
  assert.equal(frameAt(d, 184, false), 2);
  assert.equal(frameAt(d, 185, false), 3, 'la coupe démarre à 185 ms, quatrième image');
});

test('lancer : planche tournée vers la droite, miroir à gauche (Sweetie, Jennie)', () => {
  for (const key of ['sweetie', 'jennie']) {
    const r = pickSprite(hero(key, { cast: { slot: 'ult', t: 0 } }), 0);
    const l = pickSprite(hero(key, { facing: { x: -1, y: 0 }, cast: { slot: 'ult', t: 0 } }), 0);
    assert.equal(r.flip, false);
    assert.equal(l.flip, true);
    assert.notEqual(r.sheet, heroDefs[key].sprites.attack.sheet);
  }
});

test('échelles : même taille d\'affichage entre les planches d\'un même héros', () => {
  const a = heroDefs.sweetie.sprites;
  assert.ok(Math.abs(a.abilities.skill.scaleRelativeToCompanion - 0.815) < 1e-9);
  assert.equal(heroDefs.yeji.sprites.abilities.skill.scaleRelativeToCompanion, heroDefs.yeji.sprites.attack.scaleRelativeToCompanion);
  assert.equal(heroDefs.jennie.sprites.abilities.ult.scaleRelativeToCompanion, heroDefs.jennie.sprites.attack.scaleRelativeToCompanion);
});

test('ultime de Yeji : poses de maintien alternées tant que la zone dure, puis retour ; course prioritaire', () => {
  const h = hero('yeji');
  const a = pickSprite(h, 0, false, { ultActive: true });
  const b = pickSprite(h, 250, false, { ultActive: true });
  assert.equal(a.kind, 'ult-hold');
  assert.deepEqual([a.frame, b.frame], [3, 4]);
  assert.equal(pickSprite(h, 0, false, { recovering: true }).frame, 5);
  assert.equal(pickSprite(hero('yeji', { moveTarget: { x: 1, y: 1 } }), 0, false, { ultActive: true }).kind, 'running-right');
});
