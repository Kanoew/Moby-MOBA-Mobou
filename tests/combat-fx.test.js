import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, issueCommand, step } from '../src/sim/world.js';
import { gainXp } from '../src/sim/progression.js';
import { createCombatEffects, FX_LIMITS } from '../src/render/combat-fx.js';
import { createEffectsPreference } from '../src/ui/effects.js';
const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
function setup(hero = 'yeji', mode = 'full') {
  const world = createWorld({ map: load('map-3v3'), heroDefs: load('heroes'), match: { ...load('match'), items: load('items') }, roster: [
    { id: 'player', hero, team: 'ally' }, { id: 'foe', hero: 'sweetie', team: 'enemy' },
  ] });
  const [p, target] = world.heroes;
  Object.assign(p, { x: 1400, y: 300 }); Object.assign(target, { x: 1550, y: 300 }); world.time = 6000;
  const sounds = [], fx = createCombatEffects(world, { mode, onSound: (s) => sounds.push(s) }); world.onEvent = fx.onEvent;
  const tick = (ms) => { for (let i = 0; i < ms; i += 16) { step(world, 16); fx.advance(16); } };
  return { world, p, target, fx, sounds, tick, damage: (amount = 30, absorbed = 0) => fx.onEvent({ type: 'damage', sourceId: p.id, targetId: target.id, amount, absorbed, t: world.time }) };
}
const drawing = () => {
  const text = [], strokes = [];
  const ctx = new Proxy({ fillText: (t) => text.push(t), stroke: () => strokes.push(1) }, { get: (obj, key) => obj[key] ?? (() => {}) });
  return { ctx, text, strokes };
};

test('effets : préparation et coup annulé ne produisent ni impact ni dégâts flottants', () => {
  const { world, p, target, fx, sounds, tick } = setup();
  const hp = target.hp;
  issueCommand(world, p.id, { type: 'target', targetId: target.id }); tick(100);
  assert.equal(fx.stats().numbers, 0); assert.equal(fx.flashAlpha(target.id), 0);
  issueCommand(world, p.id, { type: 'steer', x: -1, y: 0 }); tick(500);
  assert.equal(target.hp, hp); assert.equal(fx.stats().bursts, 0); assert.deepEqual(sounds, []);
});

test('effets : flash et son à l’impact réel, synchronisés aux dégâts de Yeji', () => {
  const { world, p, target, fx, sounds, tick } = setup();
  issueCommand(world, p.id, { type: 'target', targetId: target.id });
  tick(p.timing.hitMs - 16); assert.equal(fx.stats().numbers, 0);
  tick(16); assert.equal(fx.stats().numbers, 1); assert.ok(fx.flashAlpha(target.id) > 0);
  assert.deepEqual(sounds, ['hit_blade']);
});

test('effets : les projectiles de Jennie ne produisent un impact qu’à leur arrivée', () => {
  const { world, p, target, fx, sounds, tick } = setup('jennie'); target.x = 1850;
  issueCommand(world, p.id, { type: 'target', targetId: target.id }); tick(p.timing.hitMs + 16);
  assert.ok(world.projectiles.length); assert.equal(fx.stats().numbers, 0);
  tick(600); assert.ok(fx.stats().numbers > 0); assert.ok(sounds.includes('hit_magic'));
});

test('effets : sons de lame, choc lourd et magie distincts, protection contre les rafales sonores', () => {
  for (const [hero, sound] of [['yeji', 'hit_blade'], ['sweetie', 'hit_heavy'], ['jennie', 'hit_magic']]) {
    const h = setup(hero); h.damage(); h.damage(); assert.deepEqual(h.sounds, [sound]);
  }
});

test('effets : aucune fuite visuelle ou sonore depuis le brouillard, même pour les lancers', () => {
  const { world, p, target, fx, sounds, damage } = setup(); target.x = 3000; target.y = 900;
  damage(); fx.onEvent({ type: 'cast_start', heroId: target.id, slot: 'ult', t: world.time });
  assert.equal(fx.stats().bursts, 0); assert.equal(fx.stats().numbers, 0); assert.deepEqual(sounds, []);
  target.x = 1550; target.y = 300; damage();
  target.invisible = true;
  const d = drawing(); fx.draw(d.ctx); fx.drawActor(d.ctx, target);
  assert.deepEqual(d.text, []); assert.deepEqual(d.strokes, []);
  assert.equal(p.hp, p.maxHp);
});

test('effets : bouclier absorbant = information bleue, sans faux impact ni secousse', () => {
  const { target, fx, sounds, damage } = setup(); damage(0, 42);
  const d = drawing(); fx.draw(d.ctx);
  assert.deepEqual(d.text, ['Absorbé 42']); assert.equal(fx.flashAlpha(target.id), 0);
  assert.equal(fx.stats().bursts, 0); assert.deepEqual(fx.shake(), { x: 0, y: 0 }); assert.deepEqual(sounds, []);
});

test('effets : regroupement des coups rapprochés, expiration et pause visuelle', () => {
  const { fx, damage } = setup(); damage(30); damage(12);
  const d = drawing(); fx.draw(d.ctx); assert.deepEqual(d.text, ['42']);
  const before = fx.stats(); fx.advance(0); assert.deepEqual(fx.stats(), before);
  for (let i = 0; i < 10; i++) fx.advance(100);
  assert.equal(fx.stats().numbers, 0); assert.equal(fx.stats().bursts, 0); assert.equal(fx.stats().flashes, 0);
});

test('effets : budgets bornés et passage immédiat en mode allégé', () => {
  const { world, p, target, fx } = setup();
  for (let i = 0; i < 200; i++) {
    const u = { ...target, id: `dummy-${i}` }; world.units.push(u); world.byId.set(u.id, u);
    fx.onEvent({ type: 'damage', sourceId: p.id, targetId: u.id, amount: 90, t: world.time });
  }
  assert.equal(fx.stats().bursts, FX_LIMITS.full.bursts); assert.equal(fx.stats().numbers, FX_LIMITS.full.numbers);
  assert.ok(fx.stats().flashes <= 64);
  fx.configure('light'); assert.equal(fx.stats().bursts, 0); assert.ok(fx.stats().numbers <= FX_LIMITS.light.numbers);
  assert.equal(fx.flashAlpha(target.id), 0); assert.deepEqual(fx.shake(), { x: 0, y: 0 });
});

test('effets : secousses courtes et plafonnées, supprimées en mode allégé', () => {
  const { p, target, fx, damage, world } = setup();
  fx.onEvent({ type: 'ability_hit', heroId: p.id, targetId: target.id, slot: 'skill', t: world.time }); damage();
  fx.advance(30); assert.ok(Math.abs(fx.shake().x) > 0); assert.ok(Math.abs(fx.shake().x) <= 2.5);
  fx.configure('light'); assert.deepEqual(fx.shake(), { x: 0, y: 0 });
});

test('effets : élimination locale annoncée sans révéler la position d’une victime cachée', () => {
  const { p, target, fx, sounds, world } = setup(); target.x = 3000; target.y = 900;
  fx.onEvent({ type: 'death', heroId: target.id, killerId: p.id, t: world.time });
  assert.equal(fx.banner().text, 'Élimination'); assert.equal(fx.stats().bursts, 0); assert.ok(sounds.includes('kill'));
  assert.deepEqual(fx.shake(), { x: 0, y: 0 });
  for (let i = 0; i < 17; i++) fx.advance(100); assert.equal(fx.banner(), null);
});

test('effets : lancement et activation des trois ultimes, sans changer leurs règles', () => {
  for (const [hero, activation] of [['yeji', 'zone_start'], ['sweetie', 'shield_on'], ['jennie', 'zone_start']]) {
    const { p, fx, sounds, world } = setup(hero);
    fx.onEvent({ type: 'cast_start', heroId: p.id, slot: 'ult', t: world.time });
    fx.onEvent({ type: activation, heroId: p.id, t: world.time });
    assert.equal(fx.stats().bursts, 2); assert.ok(sounds.includes('ult_cast'));
  }
});

test('préférence : persistance, stockage indisponible et priorité au mouvement réduit du système', () => {
  const values = new Map(), storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) }, media = { matches: false };
  const pref = createEffectsPreference(storage, media); pref.set('light');
  assert.equal(createEffectsPreference(storage).mode(), 'light'); pref.set('full');
  media.matches = true; assert.equal(pref.mode(), 'light'); media.matches = false; assert.equal(pref.mode(), 'full');
  const privatePref = createEffectsPreference({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  privatePref.set('light'); assert.equal(privatePref.mode(), 'light');
});

test('effets : même simulation avec ou sans le module de présentation', () => {
  const a = setup('sweetie'), b = setup('sweetie'); b.world.onEvent = null;
  for (const h of [a, b]) issueCommand(h.world, h.p.id, { type: 'target', targetId: h.target.id });
  a.tick(3500); b.tick(3500);
  assert.deepEqual(a.world.units, b.world.units); assert.deepEqual(a.world.stats, b.world.stats);
});


test('effets : traînée de lame uniquement autour de l’image d’impact, aucun effet sur les autos à projectile', () => {
  for (const hero of ['yeji', 'sweetie', 'jennie']) {
    const { p, fx } = setup(hero);
    p.swing = { t: 0 };
    const before = drawing(); fx.drawActor(before.ctx, p); assert.equal(before.strokes.length, 0);
    p.swing.t = p.timing.hitMs;
    const at = drawing(); fx.drawActor(at.ctx, p); assert.equal(at.strokes.length, hero === 'jennie' ? 0 : 1);
    p.swing.t = p.timing.hitMs + 150;
    const after = drawing(); fx.drawActor(after.ctx, p); assert.equal(after.strokes.length, 0);
  }
});


test('effets allégés : indicateur statique qui disparaît en fondu, sans déplacement ni expansion', () => {
  const { fx, damage } = setup('jennie', 'light'); damage();
  const a = [], b = [];
  const before = drawing(); before.ctx.ellipse = (...args) => a.push(args); fx.draw(before.ctx);
  fx.advance(60);
  const after = drawing(); after.ctx.ellipse = (...args) => b.push(args); fx.draw(after.ctx);
  assert.deepEqual(a, b); assert.deepEqual(before.text, after.text);
});


test('effets : activation réelle des ultimes et impact retardé des ronces', () => {
  for (const hero of ['yeji', 'sweetie', 'jennie']) {
    const { world, p, target, fx, sounds, tick } = setup(hero);
    gainXp(world, p, world.match.progression.levels[2]);
    const hp = target.hp;
    assert.equal(issueCommand(world, p.id, { type: 'ult' }), true);
    const ab = p.def.abilities.ult;
    tick(hero === 'jennie' ? ab.spawnMs + ab.armDelayMs + 16 : hero === 'sweetie' ? ab.shieldOnMs + 16 : ab.zoneStartMs + 16);
    assert.ok(fx.stats().bursts > 0); assert.ok(sounds.includes('ult_cast'));
    if (hero === 'sweetie') assert.ok(p.shield?.amount > 0);
    if (hero === 'yeji') assert.ok(target.slow);
    if (hero === 'jennie') { assert.ok(target.hp < hp); assert.ok(fx.stats().numbers > 0); assert.ok(sounds.includes('hit_magic')); }
  }
});
