import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createWorld, getUnit, issueCommand, step, respawnDelayMs, isVulnerable, isTargetable, attackTiming,
} from '../src/sim/world.js';
import { updateBot } from '../src/sim/bot.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const map = load('map-3v3.json');
const heroDefs = load('heroes.json');
const match = load('match.json');
const DT = 16;

function mk(roster = [{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], seed = 1) {
  const w = createWorld({ map, heroDefs, match, roster, seed });
  w.log = [];
  w.onEvent = (e) => w.log.push(e);
  return w;
}
const run = (w, ms, bots = false) => {
  for (let t = 0; t < ms; t += DT) {
    if (bots) for (const h of w.heroes) if (h.controller === 'bot') updateBot(w, h, DT);
    step(w, DT);
  }
};
const count = (w, type) => w.log.filter((e) => e.type === type).length;
const place = (u, x, y) => { u.x = x; u.y = y; };
const tower = (w, team, lane, tier) => getUnit(w, `tower-${team}-${lane}-${tier}`);

test('réapparition : 5 s jusqu\'à 2 min, 11 s à 5 min, 20 s à 9 min et après, linéaire et arrondi', () => {
  const at = (s) => respawnDelayMs(match, s * 1000);
  assert.equal(at(0), 5000);
  assert.equal(at(120), 5000);
  assert.equal(at(300), 11000);
  assert.equal(at(540), 20000);
  assert.equal(at(1200), 20000);
  assert.equal(at(210), 8000); // milieu de 120→300 : 5 + 3
  assert.equal(at(420), 16000); // 11 + 4,5 = 15,5 → 16
});

test('chrono : sortie fermée à 0:04, ouverte à 0:05', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 100);
  issueCommand(w, 'a', { type: 'move', x: 1500, y: 215 });
  run(w, 3900); // t = 4,0 s
  const sp = map.spawns.ally;
  assert.ok(Math.hypot(a.x - sp.x, a.y - sp.y) <= match.spawnZoneRadius, 'confiné dans la zone de départ à 0:04');
  run(w, 3000); // t = 7 s
  assert.ok(Math.hypot(a.x - sp.x, a.y - sp.y) > match.spawnZoneRadius + 20, 'sorti après 0:05');
});

test('vagues : rien avant 0:15, puis quatre sbires par ligne et par équipe, étalés', () => {
  const w = mk();
  run(w, 14900);
  assert.equal(count(w, 'minion_spawn'), 0);
  run(w, 200); // t = 15,1 s
  assert.ok(count(w, 'wave_spawn') === 1);
  run(w, 2000);
  assert.equal(count(w, 'minion_spawn'), 16); // 2 lignes × 2 équipes × 4
  const types = w.units.filter((u) => u.kind === 'minion' && u.team === 'ally' && u.lane === 'top').map((u) => u.minionType).sort();
  assert.deepEqual(types, ['gnome', 'gnome', 'gnome', 'troll']);
});

test('les sbires suivent leur ligne et se battent entre eux au milieu', () => {
  const w = mk();
  run(w, 34000);
  const allyTop = w.units.filter((u) => u.kind === 'minion' && u.team === 'ally' && u.lane === 'top');
  assert.ok(allyTop.every((m) => m.x > 331), 'ils avancent');
  run(w, 20000);
  assert.ok(w.log.some((e) => e.type === 'minion_died'), 'des sbires meurent au contact');
});

test('invulnérabilité : intérieure après la chute de l\'extérieure ; noyau après une ligne perdue', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  const outer = tower(w, 'enemy', 'top', 'outer');
  const inner = tower(w, 'enemy', 'top', 'inner');
  const core = getUnit(w, 'core-enemy');
  a.x = inner.x; a.y = inner.y; // la protection se teste sur des structures dans la vision
  assert.equal(isTargetable(w, a, outer), true);
  assert.equal(isTargetable(w, a, inner), false);
  assert.equal(isTargetable(w, a, core), false);
  assert.equal(issueCommand(w, 'a', { type: 'target', targetId: inner.id }), false);
  outer.dead = true;
  assert.equal(isTargetable(w, a, inner), true);
  assert.equal(isTargetable(w, a, core), false, 'une seule tour tombée ne suffit pas');
  inner.dead = true;
  assert.equal(isVulnerable(w, core), true, 'deux tours tombées sur la même ligne');
  a.x = core.x; a.y = core.y;
  assert.equal(isTargetable(w, a, core), true);
});

test('deux tours détruites sur des lignes différentes ne rendent pas le noyau vulnérable', () => {
  const w = mk();
  tower(w, 'enemy', 'top', 'outer').dead = true;
  tower(w, 'enemy', 'bottom', 'outer').dead = true;
  assert.equal(isVulnerable(w, getUnit(w, 'core-enemy')), false);
});

test('la partie s\'arrête à la destruction du noyau', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  tower(w, 'enemy', 'top', 'outer').dead = true;
  tower(w, 'enemy', 'top', 'inner').dead = true;
  const core = getUnit(w, 'core-enemy');
  core.hp = 10;
  run(w, 6000); // sort de la zone
  place(a, core.x - 200, core.y);
  assert.ok(issueCommand(w, 'a', { type: 'target', targetId: core.id }));
  run(w, 2500);
  assert.ok(core.dead);
  assert.deepEqual({ winner: w.over.winnerTeam, reason: w.over.reason }, { winner: 'ally', reason: 'core' });
  const t = w.time;
  run(w, 1000);
  assert.equal(w.time, t, 'la simulation est figée');
});

test('tour : vise un sbire avant un héros', () => {
  const w = mk();
  run(w, 6000);
  const a = getUnit(w, 'a');
  const tw = tower(w, 'enemy', 'top', 'outer');
  place(a, tw.x - 200, tw.y);
  // un sbire allié près de la tour
  w.pendingSpawns.push({ at: 0, team: 'ally', lane: 'top', type: 'gnome' });
  run(w, DT);
  const m = w.units.find((u) => u.kind === 'minion' && u.team === 'ally');
  place(m, tw.x - 250, tw.y);
  run(w, 400);
  assert.equal(tw.targetId, m.id, 'le sbire est visé en premier');
});

test('tour : le héros qui frappe un défenseur sous la tour attire les tirs, malgré un sbire plus proche', () => {
  const w = mk([
    { id: 'a', hero: 'yeji', team: 'ally' },
    { id: 'b1', hero: 'yeji', team: 'enemy' },
  ]);
  run(w, 6000);
  const tw = tower(w, 'enemy', 'top', 'outer');
  const a = getUnit(w, 'a');
  const b1 = getUnit(w, 'b1');
  w.pendingSpawns.push({ at: 0, team: 'ally', lane: 'top', type: 'gnome' });
  run(w, DT);
  const m = w.units.find((u) => u.kind === 'minion' && u.team === 'ally');
  m.hp = m.maxHp = 100000; // le sbire sert d'appât et ne meurt pas
  place(m, tw.x - 150, tw.y);
  place(b1, tw.x + 100, tw.y + 120);
  place(a, tw.x - 50, tw.y + 120); // à portée de b1, plus loin de la tour que le sbire appât
  run(w, 1500);
  assert.equal(tw.targetId, m.id, 'sans agression, le sbire passe avant le héros');
  issueCommand(w, 'a', { type: 'target', targetId: 'b1' });
  run(w, 2000);
  assert.ok(tw.aggro && tw.aggro.id === 'a', 'aggro posée sur l\'attaquant');
  assert.equal(tw.targetId, 'a', 'la tour change de cible pour l\'attaquant');
});

test('mort : délai selon le temps de partie, retour à la base en PV pleins, compteurs', () => {
  const w = mk([
    { id: 'a', hero: 'yeji', team: 'ally' },
    { id: 'b', hero: 'sweetie', team: 'enemy' },
  ]);
  run(w, 6000);
  const a = getUnit(w, 'a');
  const b = getUnit(w, 'b');
  place(a, 1500, 450);
  place(b, 1500 + a.radius + b.radius + 100, 450);
  b.hp = 1;
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 600);
  assert.ok(b.dead);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.equal(w.stats.ally.kills, 1);
  assert.equal(b.respawnAt - w.time > 4000 && b.respawnAt - w.time <= 5000, true, '5 s au début de partie');
  assert.equal(isTargetable(w, a, b), false, 'un héros mort n\'est pas ciblable');
  run(w, 5200);
  assert.equal(b.dead, false);
  assert.equal(b.hp, b.maxHp);
  const sp = map.spawns.enemy;
  assert.ok(Math.hypot(b.x - sp.x, b.y - sp.y) < 200, 'réapparu dans sa base');
  assert.equal(a.targetId, null, 'verrou levé à la mort de la cible');
});

test('assistance : un coup récent sans le coup final', () => {
  const w = mk([
    { id: 'a1', hero: 'yeji', team: 'ally' },
    { id: 'a2', hero: 'sweetie', team: 'ally' },
    { id: 'b', hero: 'jennie', team: 'enemy' },
  ]);
  run(w, 6000);
  const [a1, a2, b] = ['a1', 'a2', 'b'].map((id) => getUnit(w, id));
  place(b, 1500, 450);
  place(a1, 1500 - 150, 450);
  place(a2, 1500 + 150, 450);
  b.hp = b.maxHp = 400;
  issueCommand(w, 'a1', { type: 'target', targetId: 'b' });
  run(w, 600); // a1 touche une fois
  assert.ok(b.hp < 400 && !b.dead);
  b.hp = 1;
  issueCommand(w, 'a2', { type: 'target', targetId: 'b' });
  run(w, 600);
  assert.ok(b.dead);
  assert.equal(a2.kills + a1.kills, 1);
  assert.equal(a1.kills === 1 ? a2.assists : a1.assists, 1);
});

test('zone de départ : soin dans sa base uniquement', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  a.hp = 100;
  run(w, 2000);
  assert.ok(a.hp > 100 + 700 * 0.08 * 1.5, 'se soigne dans la base');
  run(w, 6000);
  place(a, 1500, 450);
  a.hp = 100;
  run(w, 2000);
  assert.equal(a.hp, 100, 'pas de soin hors base');
});

test('Sweetie : impact à 200 ms, animation de 460 ms (pack d\'attaque)', () => {
  assert.deepEqual(attackTiming(heroDefs.sweetie.auto), { hitMs: 200, durationMs: 460 });
});

test('bots : une équipe de bots détruit le noyau d\'un héros inactif', () => {
  const roster = [{ id: 'afk', hero: 'yeji', team: 'ally', controller: 'player', lane: 'top' }];
  for (const [i, h] of ['yeji', 'sweetie', 'jennie'].entries()) {
    roster.push({ id: `e${i}`, hero: h, team: 'enemy', controller: 'bot', lane: [ 'top', 'bottom', null ][i] });
  }
  const w = mk(roster, 2);
  run(w, 25 * 60000, true);
  assert.ok(w.over, 'la partie se termine en moins de 25 minutes');
  assert.equal(w.over.winnerTeam, 'enemy');
  assert.equal(w.over.reason, 'core');
  assert.ok(w.stats.enemy.towers >= 2, 'au moins deux tours tombées');
});

test('bots : un héros bot blessé se replie, se soigne, puis revient en lane', () => {
  const w = mk([{ id: 'bot', hero: 'yeji', team: 'ally', controller: 'bot', lane: 'top' }, { id: 'e', hero: 'yeji', team: 'enemy', controller: 'idle' }]);
  run(w, 40000, true);
  const bot = getUnit(w, 'bot');
  place(bot, 1500, 215);
  bot.hp = bot.maxHp * 0.1;
  run(w, 1000, true);
  assert.equal(bot.retreating, true);
  run(w, 30000, true);
  assert.equal(bot.retreating, false, 'soigné');
  assert.ok(bot.hp > bot.maxHp * 0.85);
  run(w, 20000, true);
  assert.ok(bot.x > 700, 'revenu vers la ligne');
});
