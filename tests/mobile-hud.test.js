import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, issueCommand } from '../src/sim/world.js';
import { gainXp } from '../src/sim/progression.js';
import { abilityHudState } from '../src/ui/touch.js';
import { mobileHudState } from '../src/ui/mobile-hud.js';
const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
function setup(hero = 'yeji') {
  const w = createWorld({ map: load('map-3v3'), heroDefs: load('heroes'), match: { ...load('match'), items: load('items') }, roster: [
    { id: 'player', hero, team: 'ally' }, { id: 'foe', hero: 'sweetie', team: 'enemy' },
  ] });
  w.time = 6000;
  return { w, h: w.heroes[0], foe: w.heroes[1] };
}

test('HUD mobile : scores et objectifs dans le sens de l’équipe locale, temps non négatif', () => {
  const { w, h, foe } = setup(); w.time = 156000; w.stats.ally.kills = 3; w.stats.enemy.kills = 2; w.stats.ally.towers = 1;
  const st = mobileHudState(w, h);
  assert.equal(st.time, '2:36'); assert.equal(st.objective, 'Cerbère · 0:54');
  assert.equal(st.ownKills, 3); assert.equal(st.enemyKills, 2); assert.equal(st.ownTowers, 1);
  assert.equal(mobileHudState(w, foe).ownKills, 2);
  w.boss.unitId = 'boss'; assert.equal(mobileHudState(w, h).objective, 'Cerbère en jeu');
  w.boss.unitId = null; w.time = w.boss.spawnAt + 9999; assert.equal(mobileHudState(w, h).objective, 'Cerbère · 0:00');
});

test('HUD mobile : vie, mort et expérience bornées, niveau maximal pris en charge', () => {
  const { w, h } = setup(); h.hp = 174.2;
  let st = mobileHudState(w, h); assert.equal(st.hp, 175); assert.ok(st.health < .25);
  h.hp = -1; h.dead = true; st = mobileHudState(w, h); assert.equal(st.hp, 0); assert.equal(st.health, 0); assert.equal(st.dead, true);
  h.hp = h.maxHp + 40; assert.equal(mobileHudState(w, h).health, 1);
  h.dead = false; gainXp(w, h, w.match.progression.levels.at(-1));
  st = mobileHudState(w, h); assert.equal(st.level, 9); assert.equal(st.xp, 1);
  assert.equal(mobileHudState({ ...w, match: null }, h), null);
});

test('HUD mobile : les lectures d’affichage ne modifient jamais les unités', () => {
  const { w, h } = setup(); const before = structuredClone(w.units);
  for (let i = 0; i < 100; i++) { mobileHudState(w, h); abilityHudState(w, h, 'skill'); }
  assert.deepEqual(w.units, before);
});

test('HUD capacités : verrou, recharge circulaire, disponibilité et commandes pendant un lancer', () => {
  for (const key of ['yeji', 'sweetie', 'jennie']) {
    const { w, h } = setup(key);
    assert.equal(abilityHudState(w, h, 'skill').state, 'locked');
    assert.equal(abilityHudState(w, h, 'ult').state, 'locked');
    gainXp(w, h, w.match.progression.levels[2]);
    assert.equal(issueCommand(w, h.id, { type: 'level_up', slot: 'skill' }), true);
    assert.equal(abilityHudState(w, h, 'skill').ready, true);
    assert.equal(issueCommand(w, h.id, { type: 'skill', x: 1000, y: 900 }), true);
    let st = abilityHudState(w, h, 'skill'); assert.equal(st.fraction, 1); assert.equal(st.seconds, 5); assert.equal(st.state, 'cooling');
    w.time += 2500; st = abilityHudState(w, h, 'skill'); assert.equal(st.fraction, .5); assert.equal(st.seconds, 3);
    assert.equal(abilityHudState(w, h, 'ult').state, 'busy', 'un autre slot disponible peut être mémorisé pendant le lancer');
    h.dead = true; assert.equal(abilityHudState(w, h, 'ult').unavailable, true);
    h.dead = false; h.cast = null; w.time += 2500;
    st = abilityHudState(w, h, 'skill'); assert.equal(st.state, 'ready'); assert.equal(st.fraction, 0);
  }
});

test('contrat HUD : identifiants des commandes conservés, icônes des trois héros définies', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['game', 'touch', 'stick-zone', 'stick-base', 'stick-knob', 'btn-attack', 'btn-skill', 'btn-ult', 'plus-attack', 'plus-skill', 'btn-cam', 'target-toggle', 'target-controls', 'btn-stop', 'btn-scores', 'btn-shop-open', 'btn-recall', 'inv-gold', 'gold-val', 'inv-slots', 'match-summary', 'hud-health', 'hud-xp']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  }
  for (const key of Object.keys(load('heroes'))) for (const slot of ['skill', 'ult']) assert.ok(html.includes(`id="hud-icon-${slot}-${key}"`));
});
