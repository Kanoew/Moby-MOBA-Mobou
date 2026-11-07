import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, getUnit, isTargetable, issueCommand, step } from '../src/sim/world.js';
import { pointVisibleTo, unitVisibleTo, VISION_RADII } from '../src/sim/vision.js';
import { awardGold, buyItem, sellItem } from '../src/sim/shop.js';
import { pickEnemyAt } from '../src/input/pointer.js';
import { pickAttackTarget } from '../src/ui/touch.js';
const load = (file) => JSON.parse(readFileSync(new URL(`../data/${file}.json`, import.meta.url)));
const mk = (duel = false) => createWorld({ map: load('map-3v3'), heroDefs: load('heroes'), match: duel ? null : { ...load('match'), items: load('items') }, roster: [
  { id: 'player', team: 'ally', hero: 'yeji' }, { id: 'scout', team: 'ally', hero: 'sweetie' }, { id: 'foe', team: 'enemy', hero: 'jennie' },
] });
const place = (u, x, y) => Object.assign(u, { x, y });

test('brouillard : territoire adverse caché, vision partagée symétrique, retour dans l’ombre après départ', () => {
  const w = mk(), foe = getUnit(w, 'foe'), scout = getUnit(w, 'scout');
  assert.equal(unitVisibleTo(w, foe, 'ally'), false);
  assert.equal(unitVisibleTo(w, getUnit(w, 'player'), 'enemy'), false);
  place(scout, foe.x - 100, foe.y);
  assert.equal(unitVisibleTo(w, foe, 'ally'), true);
  foe.invisible = true;
  assert.equal(unitVisibleTo(w, foe, 'ally'), false);
  foe.invisible = false;
  place(scout, 250, 900);
  assert.equal(unitVisibleTo(w, foe, 'ally'), false);
});

test('brouillard : seules les sources vivantes éclairent, une tour détruite ne donne plus de vision', () => {
  const w = mk();
  for (const u of w.units) if (u.team === 'ally') u.dead = true;
  const tower = getUnit(w, 'tower-ally-top-outer');
  tower.dead = false;
  assert.equal(pointVisibleTo(w, 'ally', tower.x + VISION_RADII.tower - 1, tower.y), true);
  assert.equal(pointVisibleTo(w, 'ally', tower.x + VISION_RADII.tower + 1, tower.y), false);
  tower.dead = true;
  assert.equal(pointVisibleTo(w, 'ally', tower.x, tower.y), false);
});

test('brouillard : sbires donnent la vision, monstres neutres ne donnent aucune vision aux équipes', () => {
  const w = mk();
  for (const u of w.units) if (u.team === 'ally') u.dead = true;
  w.units.push({ kind: 'minion', team: 'ally', x: 1600, y: 900, dead: false });
  assert.equal(pointVisibleTo(w, 'ally', 1600, 900), true);
  assert.equal(pointVisibleTo(w, 'enemy', 1600, 900), false);
  assert.equal(pointVisibleTo(w, 'neutral', 1600, 900), true, 'la riposte des camps ne dépend pas de la vision des équipes');
});

test('brouillard : clic, assistance tactile et commande refusent une cible cachée ; perte du verrou en sortie de vision', () => {
  const w = mk(), a = getUnit(w, 'player'), foe = getUnit(w, 'foe');
  assert.equal(isTargetable(w, a, foe), false);
  assert.equal(pickEnemyAt(w, a, foe.x, foe.y), null);
  assert.equal(pickAttackTarget(w, a, 10000, 'hero'), null);
  assert.equal(issueCommand(w, a.id, { type: 'attack', targetId: foe.id }), false);
  place(a, 1600, 300); place(foe, 1700, 300);
  assert.equal(issueCommand(w, a.id, { type: 'target', targetId: foe.id }), true);
  place(foe, 3000, 900);
  step(w, 16);
  assert.equal(a.targetId, null);
  assert.ok(w.events.some((e) => e.type === 'target_lost' && e.reason === 'invisible'));
});

test('duel : reste sans brouillard de guerre', () => {
  const w = mk(true);
  assert.equal(unitVisibleTo(w, getUnit(w, 'foe'), 'ally'), true);
});

test('or : position figée pour les effets et revente créditée une seule fois', () => {
  const w = mk(), hero = getUnit(w, 'player');
  const before = hero.gold;
  awardGold(w, hero, 25);
  assert.equal(hero.gold, before + 25);
  assert.deepEqual(w.events.at(-1), { type: 'gold', heroId: hero.id, amount: 25, x: hero.x, y: hero.y, t: 0 });
  assert.equal(buyItem(w, hero, 'lame-courte').ok, true);
  const gold = hero.gold;
  assert.equal(sellItem(w, hero, 'lame-courte').ok, true);
  const gain = w.events.at(-1).gain;
  assert.equal(hero.gold, gold + gain);
  assert.equal(w.events.filter((e) => e.type === 'gold').length, 2);
});
