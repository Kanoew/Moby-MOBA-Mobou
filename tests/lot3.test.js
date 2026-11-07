import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, getUnit, issueCommand, step, applyDamage, mitigate } from '../src/sim/world.js';
import { gainXp, awardXp } from '../src/sim/progression.js';
import { cooldownLeft, curveAt } from '../src/sim/abilities.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const map = load('map-3v3.json');
const heroDefs = load('heroes.json');
const matchFull = load('match.json');
// Les tests de règles figent l'XP du temps pour des valeurs exactes ; l'XP du temps a son propre test.
const match = { ...matchFull, progression: { ...matchFull.progression, passiveXpPerSec: 0 } };
const DT = 16;

function mk(roster) {
  const w = createWorld({ map, heroDefs, match, roster });
  w.log = [];
  w.onEvent = (e) => w.log.push(e);
  return w;
}
const duo = (a = 'yeji', b = 'jennie') => mk([{ id: 'a', hero: a, team: 'ally' }, { id: 'b', hero: b, team: 'enemy' }]);
const run = (w, ms) => { for (let t = 0; t < ms; t += DT) step(w, DT); };
const place = (u, x, y) => { u.x = x; u.y = y; };
const count = (w, type) => w.log.filter((e) => e.type === type).length;
/** Sort les héros de la zone de départ et fige le monde au milieu de la carte. */
const open = (w) => { run(w, 5200); };
/** Ajoute un ennemi factice (sbire) très résistant, immobile, pour mesurer les touches. */
function dummy(w, x, y, team = 'enemy', hp = 100000) {
  w.pendingSpawns.push({ at: 0, team, lane: 'top', type: 'gnome' });
  run(w, DT);
  const m = [...w.units].reverse().find((u) => u.kind === 'minion' && u.team === team);
  m.hp = m.maxHp = hp;
  m.def_ = 0;
  m.speed = 0;
  m.def.ai = { aggro: 0, leash: 0 }; // n'agit pas
  place(m, x, y);
  return m;
}
const levelTo = (w, id, lvl) => { const h = getUnit(w, id); gainXp(w, h, match.progression.levels[lvl - 1] - h.xp); };

test('progression : points aux niveaux 2, 4, 5, 7, 8 ; ultime automatique aux niveaux 3, 6, 9', () => {
  const w = duo();
  const a = getUnit(w, 'a');
  assert.deepEqual({ ...a.rank, lv: a.level, pts: a.points }, { auto: 1, skill: 0, ult: 0, lv: 1, pts: 0 });
  const seen = {};
  for (let lvl = 2; lvl <= 9; lvl++) {
    levelTo(w, 'a', lvl);
    seen[lvl] = { pts: a.points, ult: a.rank.ult };
  }
  assert.deepEqual(seen[2], { pts: 1, ult: 0 });
  assert.deepEqual(seen[3], { pts: 1, ult: 1 }, 'ultime rang 1 au niveau 3, point toujours en attente');
  assert.deepEqual(seen[4], { pts: 2, ult: 1 });
  assert.deepEqual(seen[5], { pts: 3, ult: 1 });
  assert.deepEqual(seen[6], { pts: 3, ult: 2 });
  assert.deepEqual(seen[7], { pts: 4, ult: 2 });
  assert.deepEqual(seen[8], { pts: 5, ult: 2 });
  assert.deepEqual(seen[9], { pts: 5, ult: 3 });
  assert.equal(a.level, 9);
  gainXp(w, a, 99999);
  assert.equal(a.level, 9, 'niveau maximum 9');
});

test('rangs : cinq points mènent exactement au rang 3 en auto et en skill ; jamais l\'ultime', () => {
  const w = duo();
  const a = getUnit(w, 'a');
  levelTo(w, 'a', 9);
  assert.equal(issueCommand(w, 'a', { type: 'level_up', slot: 'ult' }), false);
  const order = ['skill', 'auto', 'skill', 'skill', 'auto'];
  for (const slot of order) assert.equal(issueCommand(w, 'a', { type: 'level_up', slot }), true);
  assert.deepEqual({ ...a.rank }, { auto: 3, skill: 3, ult: 3 });
  assert.equal(a.points, 0);
  a.points = 1;
  assert.equal(issueCommand(w, 'a', { type: 'level_up', slot: 'skill' }), false, 'rang 3 maximum');
});

test('niveaux : les statistiques croissent et les PV montent avec le niveau', () => {
  const w = duo();
  const a = getUnit(w, 'a');
  a.hp = 350;
  levelTo(w, 'a', 5);
  assert.equal(a.maxHp, Math.round(700 * (1 + 0.08 * 4)));
  assert.equal(a.atk, Math.round(60 * (1 + 0.06 * 4)));
  assert.ok(a.hp > 350, 'les PV actuels montent aussi');
});

test('XP : partagée entre les héros proches, rien pour les éloignés', () => {
  const w = mk([{ id: 'a1', hero: 'yeji', team: 'ally' }, { id: 'a2', hero: 'sweetie', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  const [a1, a2] = ['a1', 'a2'].map((id) => getUnit(w, id));
  place(a1, 1000, 500);
  place(a2, 1100, 500);
  awardXp(w, 'ally', 1050, 500, 100);
  assert.equal(a1.xp, 50);
  assert.equal(a2.xp, 50);
  place(a2, 2900, 1500);
  awardXp(w, 'ally', 1050, 500, 100);
  assert.equal(a1.xp, 150);
  assert.equal(a2.xp, 50, 'trop loin : pas de part');
});

test('XP : un sbire tué à proximité donne de l\'XP aux héros adverses', () => {
  const w = duo();
  open(w);
  const a = getUnit(w, 'a');
  place(a, 1500, 450);
  const m = dummy(w, 1600, 450, 'enemy', 30);
  m.speed = 0;
  issueCommand(w, 'a', { type: 'target', targetId: m.id });
  run(w, 1500);
  assert.ok(m.dead);
  assert.equal(a.xp, match.units.gnome.xp);
});

test('compétence : verrouillée au rang 0, puis lançable ; recharge par rang', () => {
  const w = duo();
  const a = getUnit(w, 'a');
  open(w);
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 1000, y: 900 }), false, 'rang 0');
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 1000, y: 900 }), true);
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 1000, y: 900 }), false, 'déjà en lancer');
  run(w, 500);
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 1000, y: 900 }), false, 'en recharge');
  const cd = heroDefs.yeji.abilities.skill.cooldownMs[0];
  assert.ok(cooldownLeft(w, a, 'skill') > cd - 1000 && cooldownLeft(w, a, 'skill') <= cd);
  run(w, cd);
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 1000, y: 900 }), true);
});

test('ultime : inutilisable avant le niveau 3, puis indépendant des points', () => {
  const w = duo('sweetie', 'jennie');
  open(w);
  assert.equal(issueCommand(w, 'a', { type: 'ult' }), false);
  levelTo(w, 'a', 3);
  assert.equal(getUnit(w, 'a').points, 1, 'un point reste en attente');
  assert.equal(issueCommand(w, 'a', { type: 'ult' }), true);
});

test('Yeji · Coupe éclair : traverse les ennemis, touche chacun une fois, à partir de 185 ms', () => {
  const w = duo('yeji');
  const a = getUnit(w, 'a');
  open(w);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  place(a, 1500, 200);
  const m1 = dummy(w, 1620, 200);
  const m2 = dummy(w, 1760, 200);
  const far = dummy(w, 1900, 330);
  const hp = (m) => m.maxHp - m.hp;
  issueCommand(w, 'a', { type: 'skill', x: 2000, y: 200 });
  run(w, 150);
  assert.equal(hp(m1), 0, 'pas de dégâts avant l\'instant de frappe');
  run(w, 500);
  const dmg = mitigate(20 + 0.5 * a.atk, 0);
  assert.equal(hp(m1), dmg);
  assert.equal(hp(m2), dmg);
  assert.equal(hp(far), 0, 'hors du couloir');
  assert.ok(Math.abs(a.x - (1500 + 340)) < 3 && Math.abs(a.y - 200) < 3, 'distance du rang 1 : 340');
  assert.equal(count(w, 'ability_hit'), 2, 'une touche chacun');
});

test('Coupe éclair : vers la cible verrouillée si à portée, et s\'arrête aux obstacles', () => {
  const w = duo('yeji');
  const a = getUnit(w, 'a');
  open(w);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  place(a, 1500, 215);
  const m = dummy(w, 1500, 400);
  issueCommand(w, 'a', { type: 'target', targetId: m.id });
  issueCommand(w, 'a', { type: 'skill', x: 1900, y: 215 }); // visée ailleurs : le verrou l'emporte
  run(w, 600);
  assert.ok(a.y > 300 && Math.abs(a.x - 1500) < 5, 'dash vers la cible, pas vers le point visé');
  assert.ok(a.y <= 400 + 90 + 5, 'ne dépasse pas la cible de plus de endsPast');

  const w2 = duo('yeji');
  const a2 = getUnit(w2, 'a');
  open(w2);
  levelTo(w2, 'a', 2);
  issueCommand(w2, 'a', { type: 'level_up', slot: 'skill' });
  place(a2, 1100 - 80 - 26 - 100, 730); // rocher en (1100,730) r80
  issueCommand(w2, 'a', { type: 'skill', x: 1500, y: 730 });
  run(w2, 600);
  assert.ok(a2.x < 1100 - 80, 'arrêté par le rocher');
});

test('un lancer occupe le héros : déplacement refusé pendant l\'animation, accepté ensuite', () => {
  const w = duo('yeji');
  open(w);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  issueCommand(w, 'a', { type: 'skill', x: 1000, y: 900 });
  assert.equal(issueCommand(w, 'a', { type: 'move', x: 900, y: 900 }), false);
  run(w, 460);
  assert.equal(issueCommand(w, 'a', { type: 'move', x: 900, y: 900 }), true);
});

test('Sweetie · Ruée : s\'arrête au contact de la première cible et ne touche qu\'elle', () => {
  const w = duo('sweetie');
  const a = getUnit(w, 'a');
  open(w);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  place(a, 1500, 200);
  const m1 = dummy(w, 1680, 200);
  const m2 = dummy(w, 1740, 200);
  issueCommand(w, 'a', { type: 'skill', x: 2000, y: 200 });
  run(w, 500);
  assert.ok(m1.hp < m1.maxHp, 'la première cible est touchée');
  assert.equal(m2.hp, m2.maxHp, 'la seconde, non');
  assert.ok(a.x < m1.x - a.radius - m1.radius + 2, 'arrêtée au contact');
  assert.equal(count(w, 'ability_hit'), 1);
});

test('courbe de déplacement de la Ruée : immobile jusqu\'à 100 ms, arrivée à 260 ms', () => {
  const c = heroDefs.sweetie.abilities.skill.movementCurve;
  assert.equal(curveAt(c, 100), 0);
  assert.equal(curveAt(c, 205), 0.76);
  assert.equal(curveAt(c, 260), 1);
  assert.equal(curveAt(c, 340), 1);
});

test('Jennie · Triple bouquet : trois projectiles à −15°, 0°, +15°, une seule fois à 235 ms', () => {
  const w = duo('jennie');
  const a = getUnit(w, 'a');
  open(w);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  place(a, 1000, 900);
  issueCommand(w, 'a', { type: 'skill', x: 1500, y: 900 });
  run(w, 224);
  assert.equal(w.projectiles.length, 0);
  run(w, 32);
  assert.equal(count(w, 'spawn_projectile_fan'), 1);
  assert.equal(w.projectiles.length, 3);
  const ang = w.projectiles.map((p) => Math.round((Math.atan2(p.dir.y, p.dir.x) * 180) / Math.PI)).sort((x, y) => x - y);
  assert.deepEqual(ang, [-15, 0, 15]);
  const up = w.projectiles.find((p) => Math.round((Math.atan2(p.dir.y, p.dir.x) * 180) / Math.PI) === 15);
  assert.ok(up.dir.y > 0, 'angle positif = sens horaire à l\'écran (vers le bas)');
});

test('triple bouquet : touche le premier ennemi en ligne, portée limitée', () => {
  const w = duo('jennie');
  const a = getUnit(w, 'a');
  open(w);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  place(a, 1000, 900);
  const near = dummy(w, 1300, 900);
  const behind = dummy(w, 1400, 900);
  const far = dummy(w, 1000 + 600 + 200, 1000 - 100);
  issueCommand(w, 'a', { type: 'skill', x: 1500, y: 900 });
  run(w, 1500);
  assert.ok(near.hp < near.maxHp, 'premier ennemi touché');
  assert.equal(behind.hp, behind.maxHp, 'celui qui est derrière est protégé par le premier');
  assert.equal(far.hp, far.maxHp, 'hors de portée');
  assert.equal(w.projectiles.length, 0, 'projectiles terminés');
});

test('Sweetie · Bouclier : actif à 220 ms, absorbe après la Défense, expire à 4 220 ms', () => {
  const w = duo('sweetie');
  const a = getUnit(w, 'a');
  open(w);
  levelTo(w, 'a', 3);
  const hp0 = a.hp;
  const t0 = w.time;
  issueCommand(w, 'a', { type: 'ult' });
  run(w, 208);
  assert.equal(a.shield, null);
  run(w, 32);
  assert.ok(a.shield && a.shield.amount === 150);
  // 100 dégâts après Défense : le bouclier encaisse tout.
  const raw = (100 * (100 + a.def_)) / 100;
  applyDamage(w, getUnit(w, 'b'), a, raw);
  assert.equal(a.hp, hp0);
  assert.equal(a.shield.amount, 50);
  applyDamage(w, getUnit(w, 'b'), a, raw);
  assert.equal(a.shield, null, 'bouclier épuisé');
  assert.equal(a.hp, hp0 - 50, 'le reste passe aux PV');
  // Expiration : nouveau bouclier, vérifié à 4 220 ms après le lancer.
  const w2 = duo('sweetie');
  open(w2);
  levelTo(w2, 'a', 3);
  const b0 = w2.time;
  issueCommand(w2, 'a', { type: 'ult' });
  run(w2, 4200);
  assert.ok(getUnit(w2, 'a').shield, 'toujours actif à 4 200 ms');
  run(w2, 40);
  assert.equal(getUnit(w2, 'a').shield, null);
  const off = w2.log.find((e) => e.type === 'shield_off');
  assert.ok(Math.abs(off.t - b0 - 4220) <= DT + 1, `retiré à ${off.t - b0} ms`);
  void t0;
});

test('Yeji · Cercle des lames : ralentit les ennemis dans la zone qui suit Yeji, pas les autres', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }, { id: 'c', hero: 'sweetie', team: 'enemy' }]);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => getUnit(w, id));
  open(w);
  levelTo(w, 'a', 3);
  place(a, 1500, 900);
  place(b, 1500 + 120, 900);
  place(c, 1500 + 700, 1200);
  issueCommand(w, 'a', { type: 'ult' });
  run(w, 300);
  assert.equal(w.zones.length, 1);
  issueCommand(w, 'b', { type: 'move', x: 1500 + 120, y: 900 - 800 });
  issueCommand(w, 'c', { type: 'move', x: 1500 + 700, y: 1200 + 400 });
  const b0 = { x: b.x, y: b.y };
  const c0 = { x: c.x, y: c.y };
  run(w, 500);
  const db = Math.hypot(b.x - b0.x, b.y - b0.y);
  const dc = Math.hypot(c.x - c0.x, c.y - c0.y);
  assert.ok(Math.abs(db / dc - 0.7) < 0.05, `ralentissement de 30 % (rapport ${db / dc})`);
  // La zone suit Yeji.
  place(a, 900, 500);
  run(w, 50);
  assert.ok(Math.hypot(w.zones[0].x - 900, w.zones[0].y - 500) < 5);
  // Fin 4 s après le début de la zone.
  run(w, 4000);
  assert.equal(w.zones.length, 0);
});

test('ralentissements : le plus fort l\'emporte, pas d\'empilement, plancher de vitesse', () => {
  const w = duo();
  const b = getUnit(w, 'b');
  const spd = b.speed;
  b.slow = null;
  const apply = (f) => { if (!b.slow || f >= b.slow.frac) b.slow = { frac: f, until: w.time + 1000 }; };
  apply(0.3);
  apply(0.5);
  apply(0.3);
  assert.equal(b.slow.frac, 0.5);
  b.slow = { frac: 0.95, until: w.time + 1000 };
  b.x = 1500; b.y = 900;
  issueCommand(w, 'b', { type: 'move', x: 1500, y: 700 });
  b.slow = { frac: 0.95, until: w.time + 1000 };
  run(w, 500);
  const moved = Math.hypot(b.x - 1500, b.y - 900);
  assert.ok(moved >= spd * match.slowMinSpeed * 0.45, 'jamais sous le plancher de vitesse');
});

test('Jennie · Couronne de ronces : posée à 180 ms, dégâts après le délai, ne suit pas Jennie', () => {
  const w = duo('jennie', 'yeji');
  const [a, b] = [getUnit(w, 'a'), getUnit(w, 'b')];
  open(w);
  levelTo(w, 'a', 3);
  place(a, 1500, 900);
  place(b, 1500 + 150, 900);
  const far = dummy(w, 1500 + 600, 900);
  const hp0 = b.hp;
  issueCommand(w, 'a', { type: 'ult' });
  run(w, 170);
  assert.equal(w.zones.length, 0, 'pas avant 180 ms');
  run(w, 30);
  assert.equal(w.zones.length, 1);
  assert.deepEqual([w.zones[0].x, w.zones[0].y], [1500, 900]);
  run(w, 300);
  assert.equal(b.hp, hp0, 'aucun dégât pendant le délai d\'armement');
  run(w, 400); // 0,6 s après la pose
  assert.ok(b.hp < hp0, 'rafale d\'armement');
  const afterBurst = b.hp;
  run(w, 800);
  assert.ok(b.hp < afterBurst, 'dégâts périodiques pendant la durée');
  assert.equal(far.hp, far.maxHp, 'hors du rayon');
  place(a, 700, 500);
  run(w, 100);
  assert.deepEqual([w.zones[0].x, w.zones[0].y], [1500, 900], 'la zone reste en place');
  run(w, 4000);
  assert.equal(w.zones.length, 0);
});

/* ------------------------------- jungle & boss ------------------------------- */

test('camps : absents avant 0:30, symétriques, passifs, ripostent, réapparaissent après 60 s', () => {
  const w = duo();
  run(w, 29900);
  assert.equal(w.units.filter((u) => u.kind === 'monster').length, 0);
  run(w, 400);
  const mons = w.units.filter((u) => u.kind === 'monster');
  assert.equal(mons.length, 12, 'deux camps de trois monstres par côté');
  // symétrie : chaque camp a son miroir exact
  for (const c of w.camps.filter((c) => c.side === 'ally')) {
    const mirror = w.camps.find((m) => m.side === 'enemy' && m.id.endsWith(c.id.split('-')[2]));
    assert.equal(c.x + mirror.x, map.width);
    assert.equal(c.y, mirror.y);
  }
  // passifs : un héros qui passe à côté ne se fait pas attaquer
  open(w);
  const a = getUnit(w, 'a');
  const camp = w.camps.find((c) => c.side === 'ally' && c.kind === 'fleurs');
  const mon = getUnit(w, camp.unitIds[0]);
  place(a, mon.x + 80, mon.y);
  run(w, 2000);
  assert.equal(a.hp, a.maxHp);
  issueCommand(w, 'a', { type: 'target', targetId: mon.id });
  run(w, 600);
  assert.equal(mon.aggroId, 'a', 'riposte');
  run(w, 700);
  assert.ok(a.hp < a.maxHp, 'le monstre frappe en retour');
  // tuer les deux monstres : XP et réapparition 60 s plus tard
  for (const id of camp.unitIds) getUnit(w, id).hp = 1;
  const xp0 = a.xp;
  run(w, 500);
  const kill = () => {
    for (const id of camp.unitIds) {
      const m = getUnit(w, id);
      if (!m.dead) { m.hp = 1; issueCommand(w, 'a', { type: 'target', targetId: id }); run(w, 1500); }
    }
  };
  kill();
  assert.ok(a.xp > xp0, 'XP des camps');
  assert.ok(camp.respawnAt !== null);
  const t = camp.respawnAt - w.time;
  assert.ok(t > 0 && t <= 60000);
  run(w, t + 100);
  assert.ok(camp.unitIds.some((id) => !getUnit(w, id).dead), 'le camp a réapparu');
});

test('monstre : abandonne la poursuite hors de sa laisse, revient et se soigne', () => {
  const w = duo();
  run(w, 30500);
  open(w);
  const a = getUnit(w, 'a');
  const camp = w.camps.find((c) => c.side === 'ally' && c.kind === 'fleurs');
  const mon = getUnit(w, camp.unitIds[0]);
  mon.hp = mon.maxHp * 0.5;
  mon.aggroId = 'a';
  place(a, mon.x + 700, mon.y);
  run(w, 3000);
  assert.equal(mon.aggroId, null);
  run(w, 6000);
  assert.ok(Math.hypot(mon.x - mon.home.x, mon.y - mon.home.y) < 6, 'revenu au point d\'attache');
  assert.equal(mon.hp, mon.maxHp, 'soigné');
});

test('boss : annonce à 3:15, apparition à 3:30 au centre exact, retour à 7:40 si tué à 4:10', () => {
  const w = duo();
  run(w, 194900);
  assert.equal(count(w, 'boss_announce'), 0);
  run(w, 200); // 3:15,1
  assert.equal(count(w, 'boss_announce'), 1);
  const ann = w.log.find((e) => e.type === 'boss_announce').spawnInMs;
  assert.ok(ann > 14900 && ann <= 15000, 'annonce 15 s avant');
  run(w, 14700); // 3:29,8
  assert.equal(w.boss.unitId, null);
  run(w, 400);
  const boss = getUnit(w, w.boss.unitId);
  assert.deepEqual([boss.x, boss.y], [map.width / 2, map.height / 2], 'centre exact de la carte');
  assert.equal(count(w, 'boss_spawn'), 1);
  // Mort à 4:10 : retour à 7:40.
  run(w, 250000 - w.time);
  applyDamage(w, getUnit(w, 'a'), boss, 1e9);
  assert.ok(boss.dead);
  assert.ok(Math.abs(w.boss.spawnAt - 460000) <= DT, `retour prévu à ${w.boss.spawnAt}`);
  run(w, 459900 - w.time);
  assert.equal(w.boss.unitId, null);
  run(w, 300);
  assert.notEqual(w.boss.unitId, null);
  assert.equal(count(w, 'boss_spawn'), 2);
});

test('boss : un duo le bat pendant que le troisième tient une ligne, sans perdre un héros', () => {
  const w = mk([
    { id: 'a1', hero: 'yeji', team: 'ally' },
    { id: 'a2', hero: 'jennie', team: 'ally' },
    { id: 'b', hero: 'sweetie', team: 'enemy' },
  ]);
  run(w, 211000);
  const boss = getUnit(w, w.boss.unitId);
  const [a1, a2] = ['a1', 'a2'].map((id) => getUnit(w, id));
  for (const id of ['a1', 'a2']) levelTo(w, id, 4);
  a1.hp = a1.maxHp; a2.hp = a2.maxHp;
  place(a1, boss.x - 200, boss.y);
  place(a2, boss.x - 420, boss.y + 60);
  issueCommand(w, 'a1', { type: 'target', targetId: boss.id });
  issueCommand(w, 'a2', { type: 'target', targetId: boss.id });
  const t0 = w.time;
  run(w, 90000);
  assert.ok(boss.dead, 'le boss tombe');
  const diedAt = w.log.find((e) => e.type === 'monster_died' && e.boss).t;
  assert.ok(diedAt - t0 < 40000, `en moins de 40 s (${(diedAt - t0) / 1000} s)`);
  assert.equal(a1.dead || a2.dead, false, 'sans mort');
  assert.equal(a1.deaths + a2.deaths, 0);
});

test('récompense du boss : vague renforcée sur la ligne choisie par le joueur crédité, une seule fois', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  run(w, 211000);
  const boss = getUnit(w, w.boss.unitId);
  applyDamage(w, getUnit(w, 'a'), boss, 1e9);
  assert.equal(w.bonus.choices.length, 1);
  assert.equal(w.bonus.choices[0].chooserId, 'a');
  assert.equal(issueCommand(w, 'a', { type: 'choose_bonus_lane', lane: 'bottom' }), true);
  assert.equal(w.bonus.pending.ally.bottom, 1);
  assert.equal(issueCommand(w, 'a', { type: 'choose_bonus_lane', lane: 'top' }), false, 'un seul choix');
  const composition = () => {
    const spawns = w.log.filter((e) => e.type === 'minion_spawn' && e.t > w.time - 5000);
    return spawns;
  };
  run(w, 2000); // laisse finir l'étalement de la vague en cours
  w.log.length = 0;
  const iv = match.waves.intervalMs;
  run(w, iv - ((w.time - match.waves.firstMs) % iv) + 3000); // jusqu'après la prochaine vague
  const mine = (lane) => w.units.filter((u) => u.kind === 'minion' && u.team === 'ally' && u.lane === lane && u.minionType === 'brute');
  const brutesBottom = w.log.filter((e) => e.type === 'minion_spawn' && e.team === 'ally' && e.lane === 'bottom').length;
  const normalTop = w.log.filter((e) => e.type === 'minion_spawn' && e.team === 'ally' && e.lane === 'top').length;
  assert.equal(brutesBottom, 6, 'ligne choisie : 3 gnomes + 1 troll, plus 2 trolls');
  assert.equal(normalTop, 4, 'l\'autre ligne : vague normale');
  assert.equal(w.bonus.pending.ally.bottom, 0, 'bonus consommé');
  void composition; void mine;
  w.log.length = 0;
  run(w, iv + 1000);
  assert.equal(w.log.filter((e) => e.type === 'minion_spawn' && e.team === 'ally' && e.lane === 'bottom').length, 4, 'vague suivante normale');
});

test('récompense du boss : choix par défaut au bout de 10 s ; tué par un sbire = défaut immédiat', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  run(w, 211000);
  const boss = getUnit(w, w.boss.unitId);
  applyDamage(w, getUnit(w, 'a'), boss, 1e9);
  run(w, 9500);
  assert.equal(w.bonus.pending.ally.top, 0);
  run(w, 800);
  assert.equal(w.bonus.pending.ally.top, 1, 'ligne par défaut (haut) après 10 s');
  assert.ok(w.log.some((e) => e.type === 'bonus_lane' && e.byDefault));
});
