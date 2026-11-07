import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, getHero, issueCommand, step, edgeDistance, mitigate, attackTiming } from '../src/sim/world.js';
import { updateBot } from '../src/sim/bot.js';
import { frameAt, directionFromFacing } from '../src/render/animator.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const map = load('map.json');
const heroDefs = load('heroes.json');
const DT = 16;

function duel(playerHero = 'yeji', botHero = 'jennie') {
  const world = createWorld({
    map,
    heroDefs,
    roster: [
      { id: 'a', hero: playerHero, team: 'ally' },
      { id: 'b', hero: botHero, team: 'enemy' },
    ],
  });
  world.log = [];
  world.onEvent = (e) => world.log.push(e);
  return world;
}
const run = (world, ms, bots = false) => {
  for (let t = 0; t < ms; t += DT) {
    if (bots) for (const h of world.heroes) if (h.controller === 'bot') updateBot(world, h, DT);
    step(world, DT);
  }
};
const place = (h, x, y) => {
  h.x = x;
  h.y = y;
};
const count = (world, type) => world.log.filter((e) => e.type === type).length;

test('katana : impact à l\'image 2 = 400 ms après le début du coup', () => {
  const t = attackTiming(heroDefs.yeji.auto);
  assert.equal(t.hitMs, 400);
  assert.equal(t.durationMs, 1030);
});

test('bouquet : spawn_projectile à 240 ms, animation de 510 ms', () => {
  const t = attackTiming(heroDefs.jennie.auto);
  assert.equal(t.hitMs, 240);
  assert.equal(t.durationMs, 510);
});

test('Défense unique : 100 / (100 + déf)', () => {
  assert.equal(mitigate(60, 0), 60);
  assert.equal(mitigate(60, 100), 30);
  assert.equal(mitigate(1, 10000), 1);
});

test('verrou : clic ennemi verrouille sans déplacer', () => {
  const w = duel();
  const a = getHero(w, 'a');
  const before = { x: a.x, y: a.y };
  assert.ok(issueCommand(w, 'a', { type: 'target', targetId: 'b' }));
  run(w, 500);
  assert.equal(a.targetId, 'b');
  assert.deepEqual({ x: a.x, y: a.y }, before);
});

test('on ne peut pas verrouiller un allié ni un invisible', () => {
  const w = duel();
  assert.equal(issueCommand(w, 'a', { type: 'target', targetId: 'a' }), false);
  getHero(w, 'b').invisible = true;
  assert.equal(issueCommand(w, 'a', { type: 'target', targetId: 'b' }), false);
});

test('autos répétées à la cadence du héros tant que la cible est à portée', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 500, 450);
  place(b, 500 + a.radius + b.radius + 100, 450);
  b.hp = b.maxHp = 100000; // pour mesurer sans mourir
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 3400);
  // Départs à 0, 1100, 2200, 3300 ms ; impact 400 ms plus tard : 3 impacts dans 3400 ms.
  assert.equal(count(w, 'swing_start'), 4);
  assert.equal(w.log.filter((e) => e.type === 'hit' && e.heroId === 'a').length, 3);
});

test('hors portée : la cible reste verrouillée, aucune attaque, aucune poursuite', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 300, 450);
  place(b, 1000, 450);
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 3000);
  assert.equal(a.targetId, 'b');
  assert.equal(count(w, 'swing_start'), 0);
  assert.equal(a.x, 300);
  assert.equal(b.hp, b.maxHp);
});

test('la cible sort de portée : l\'attaque se met en pause, la rentrée à portée la relance', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 500, 450);
  place(b, 500 + a.radius + b.radius + 100, 450);
  b.hp = b.maxHp = 100000;
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 1500);
  const started = count(w, 'swing_start');
  assert.ok(started >= 1);
  place(b, 1200, 450); // hors portée
  run(w, 2500);
  assert.equal(count(w, 'swing_start'), started, 'aucun nouveau coup hors portée');
  assert.equal(a.targetId, 'b', 'verrou conservé');
  place(b, 500 + a.radius + b.radius + 100, 450);
  run(w, 200);
  assert.equal(count(w, 'swing_start'), started + 1, 'le coup repart dès le retour à portée');
});

test('le déplacement suspend les autos et les reprend à l\'arrêt', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 500, 450);
  place(b, 500 + a.radius + b.radius + 100, 450);
  b.hp = b.maxHp = 100000;
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 200); // en plein coup, avant l'impact
  assert.ok(a.swing && !a.swing.hitDone);
  issueCommand(w, 'a', { type: 'move', x: 500, y: 420 });
  assert.equal(a.swing, null, 'coup annulé avant impact');
  assert.equal(count(w, 'hit'), 0, 'aucun dégât');
  run(w, 400);
  assert.equal(a.moveTarget, null, 'arrivé');
  assert.equal(count(w, 'hit'), 0, 'aucune auto pendant la marche');
  run(w, 1200);
  assert.ok(count(w, 'hit') >= 1, 'les autos reprennent une fois arrêté, cible à portée');
});

test('cible morte ou invisible : désélection', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 500, 450);
  place(b, 500 + a.radius + b.radius + 100, 450);
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  b.invisible = true;
  run(w, DT * 2);
  assert.equal(a.targetId, null);
  assert.ok(w.log.some((e) => e.type === 'target_lost' && e.reason === 'invisible'));

  const w2 = duel();
  const [a2, b2] = [getHero(w2, 'a'), getHero(w2, 'b')];
  place(a2, 500, 450);
  place(b2, 500 + a2.radius + b2.radius + 100, 450);
  b2.hp = 1;
  b2.def_ = 0;
  issueCommand(w2, 'a', { type: 'target', targetId: 'b' });
  run(w2, 600);
  assert.ok(b2.dead);
  assert.ok(w2.over && w2.over.winnerTeam === 'ally');
});

test('coup de katana raté si la cible a quitté la zone avant l\'impact', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 500, 450);
  place(b, 500 + a.radius + b.radius + 100, 450);
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 100);
  place(b, 900, 450);
  run(w, 500);
  assert.equal(count(w, 'whiff'), 1);
  assert.equal(b.hp, b.maxHp);
});

test('projectile : une seule apparition par attaque, à 240 ms, puis impact', () => {
  const w = duel('jennie', 'yeji');
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 300, 450);
  place(b, 700, 450);
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 224);
  assert.equal(count(w, 'spawn_projectile'), 0);
  run(w, 32);
  assert.equal(count(w, 'spawn_projectile'), 1);
  run(w, 1000);
  assert.equal(count(w, 'spawn_projectile'), 2, 'deuxième attaque à 900 ms, pas avant');
  assert.ok(b.hp < b.maxHp);
});

test('collisions : ni les bords ni les obstacles ne se traversent', () => {
  const w = duel();
  const a = getHero(w, 'a');
  place(a, 400, 270);
  issueCommand(w, 'a', { type: 'move', x: 1200, y: 270 }); // le rocher en (800,270) est dans la ligne
  let minGap = Infinity;
  for (let i = 0; i < 6000 / DT; i++) {
    step(w, DT);
    for (const o of map.obstacles.filter((o) => o.type === 'circle')) minGap = Math.min(minGap, Math.hypot(a.x - o.x, a.y - o.y) - o.r - a.radius);
  }
  assert.ok(minGap >= -0.5, `jamais dans un rocher (écart min ${minGap})`);
  assert.ok(Math.abs(a.x - 1200) < 2 && Math.abs(a.y - 270) < 2, 'contourne puis arrive');
  for (const o of map.obstacles.filter((o) => o.type === 'circle')) {
    assert.ok(Math.hypot(a.x - o.x, a.y - o.y) >= o.r + a.radius - 0.5);
  }
  issueCommand(w, 'a', { type: 'move', x: -500, y: -500 });
  run(w, 6000);
  assert.ok(a.x >= a.radius - 0.001 && a.y >= a.radius - 0.001);
});

test('collision rectangle : jamais à l\'intérieur', () => {
  const w = duel();
  const a = getHero(w, 'a');
  place(a, 400, 450);
  issueCommand(w, 'a', { type: 'move', x: 700, y: 450 });
  run(w, 4000);
  const r = map.obstacles.find((o) => o.type === 'rect');
  const inside = a.x > r.x - r.w / 2 - a.radius + 0.5 && a.x < r.x + r.w / 2 + a.radius - 0.5 && Math.abs(a.y - r.y) < r.h / 2;
  assert.equal(inside, false);
});

test('les deux héros ne se traversent pas', () => {
  const w = duel();
  const [a, b] = [getHero(w, 'a'), getHero(w, 'b')];
  place(a, 500, 450);
  place(b, 560, 450);
  run(w, DT * 10);
  assert.ok(edgeDistance(a, b) >= -0.5);
});

test('bot : même API de commandes, gagne contre un joueur inactif', () => {
  const w = duel('yeji', 'jennie');
  getHero(w, 'b').controller = 'bot';
  run(w, 60000, true);
  assert.ok(w.over, 'la partie se termine');
  assert.equal(w.over.winnerTeam, 'enemy');
});

test('animation : repères d\'image', () => {
  const d = heroDefs.yeji.auto.frameDurationsMs;
  assert.equal(frameAt(d, 0, false), 0);
  assert.equal(frameAt(d, 399, false), 1);
  assert.equal(frameAt(d, 400, false), 2);
  assert.equal(frameAt(d, 99999, false), 5);
  assert.equal(directionFromFacing({ x: 1, y: 0.2 }), 'right');
  assert.equal(directionFromFacing({ x: -1, y: 0.2 }), 'left');
  assert.equal(directionFromFacing({ x: 0.1, y: 1 }), 'front');
  assert.equal(directionFromFacing({ x: 0.1, y: -1 }), 'back');
});

test('chemin : contourne les obstacles pour rejoindre un point derrière un bloc', () => {
  const w = duel();
  const a = getHero(w, 'a');
  place(a, 400, 450);
  issueCommand(w, 'a', { type: 'move', x: 1200, y: 450 }); // deux blocs rectangulaires sur l'axe
  assert.ok(a.path.length > 1, 'le chemin comporte des étapes');
  run(w, 5000);
  assert.ok(Math.abs(a.x - 1200) < 2 && Math.abs(a.y - 450) < 2);
});

test('clic dans un obstacle : destination ajustée au point libre le plus proche', () => {
  const w = duel();
  const a = getHero(w, 'a');
  place(a, 400, 450);
  issueCommand(w, 'a', { type: 'move', x: 800, y: 270 }); // centre d'un rocher
  const o = map.obstacles[0];
  const d = Math.hypot(a.moveTarget.x - o.x, a.moveTarget.y - o.y);
  assert.ok(d >= o.r + a.radius * 0.98 - 0.5);
});
