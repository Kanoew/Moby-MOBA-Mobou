import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createWorld, getUnit, issueCommand, step, mitigate, applyDamage } from '../src/sim/world.js';
import { gainXp } from '../src/sim/progression.js';
import { updateBot } from '../src/sim/bot.js';
import { cooldownLeft } from '../src/sim/abilities.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(`data/${p}`, root), 'utf8'));
const map = load('map-3v3.json');
const heroDefs = load('heroes.json');
const match = load('match.json');
const DT = 16;

function mk(roster, m = match, seed = 1) {
  const w = createWorld({ map, heroDefs, match: m, roster, seed });
  w.log = [];
  w.onEvent = (e) => w.log.push(e);
  return w;
}
const duo = () => mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
const run = (w, ms, bots = false) => {
  for (let t = 0; t < ms; t += DT) {
    if (bots) for (const h of w.heroes) if (h.controller === 'bot') updateBot(w, h, DT);
    step(w, DT);
  }
};
const place = (u, x, y) => { u.x = x; u.y = y; };

/* --------------------------------- recharges --------------------------------- */

test('recharges : skills 5 / 4,5 / 4 s selon le rang, ultimes 45 s', () => {
  for (const [key, def] of Object.entries(heroDefs)) {
    assert.deepEqual(def.abilities.skill.cooldownMs, [5000, 4500, 4000], `${key} skill`);
    assert.deepEqual(def.abilities.ult.cooldownMs, [45000, 45000, 45000], `${key} ultime`);
  }
});

test('recharges en jeu : le skill est relançable après 5 s, l\'ultime après 45 s', () => {
  const w = mk([{ id: 'a', hero: 'sweetie', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  const a = getUnit(w, 'a');
  run(w, 5200);
  gainXp(w, a, match.progression.levels[2] - a.xp);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  issueCommand(w, 'a', { type: 'skill', x: 900, y: 900 });
  const t0 = w.time;
  assert.equal(cooldownLeft(w, a, 'skill'), 5000);
  run(w, 4900);
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 900, y: 900 }), false);
  run(w, 200);
  assert.equal(issueCommand(w, 'a', { type: 'skill', x: 900, y: 900 }), true, `relancée à ${w.time - t0} ms`);
  run(w, 400); // fin de l'animation du skill
  issueCommand(w, 'a', { type: 'ult' });
  assert.equal(cooldownLeft(w, a, 'ult'), 45000);
});

/* ------------------------------------ XP ------------------------------------ */

test('XP du temps : chaque héros vivant gagne le même débit, un héros mort n\'en gagne pas', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  const [a, b] = [getUnit(w, 'a'), getUnit(w, 'b')];
  run(w, 10000);
  const rate = match.progression.passiveXpPerSec;
  assert.ok(Math.abs(a.xp - rate * 10) <= 1, `XP après 10 s : ${a.xp}`);
  assert.equal(a.xp, b.xp);
  b.dead = true;
  b.respawnAt = null;
  const before = b.xp;
  run(w, 5000);
  assert.equal(b.xp, before, 'un héros mort ne gagne rien');
  assert.ok(a.xp > before);
});

test('XP au prorata : les kills ajoutent à l\'XP du temps ; troll > gnome ; camp > ligne', () => {
  assert.ok(match.units.troll.xp > match.units.gnome.xp);
  assert.ok(match.units['fleur-large'].xp > match.units['fleur-small'].xp);
  assert.ok(match.units['fleur-large'].xp > match.units.troll.xp);
  assert.ok(match.units.boss.xp > match.units['dragon-large'].xp);
  const w = duo();
  const a = getUnit(w, 'a');
  run(w, 6000);
  place(a, 1500, 450);
  const base = a.xp;
  w.pendingSpawns.push({ at: 0, team: 'enemy', lane: 'top', type: 'gnome' });
  run(w, DT);
  const m = [...w.units].reverse().find((u) => u.kind === 'minion');
  place(m, 1560, 450);
  m.hp = 1;
  issueCommand(w, 'a', { type: 'target', targetId: m.id });
  run(w, 1000);
  assert.ok(m.dead);
  assert.ok(a.xp - base >= match.units.gnome.xp, 'au moins l\'XP du gnome en plus de celle du temps');
});

test('rythme : niveau 2 en moins d\'une minute, l\'ultime (niveau 3) pas avant 3 min sans aucun kill', () => {
  const w = duo();
  const a = getUnit(w, 'a');
  run(w, 60000);
  assert.equal(a.level, 2);
  run(w, 120000); // 3:00 : 360 XP du temps seul
  assert.equal(a.level, 2, 'sans kill, le niveau 3 n\'est pas atteint à 3:00');
  assert.equal(a.rank.ult, 0, 'ultime encore verrouillé');
  run(w, 40000);
  assert.ok(a.level >= 3 && a.rank.ult === 1);
});

/* ----------------------------- durée de la partie ----------------------------- */

test('la partie dure au plus 10 minutes : fin au temps, vainqueur aux dégâts sur les structures', () => {
  assert.equal(match.timeLimitMs, 600000);
  const w = duo();
  const t = getUnit(w, 'tower-enemy-top-outer');
  t.hp -= 300;
  run(w, 605000);
  assert.ok(w.over);
  assert.equal(w.over.reason, 'time');
  assert.equal(w.over.atMs <= 600000 + DT, true);
  assert.equal(w.over.winnerTeam, 'ally');
});

test('temps écoulé : à égalité de structures, les éliminations départagent ; sinon égalité', () => {
  // Sans vague, aucune structure n'est touchée : l'égalité est exacte.
  const calm = { ...match, waves: { ...match.waves, firstMs: 1e9 } };
  const mkCalm = () => mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], calm);
  const w = mkCalm();
  w.stats.enemy.kills = 2;
  run(w, 605000);
  assert.equal(w.over.reason, 'time');
  assert.equal(w.over.winnerTeam, 'enemy');
  const w2 = mkCalm();
  run(w2, 605000);
  assert.equal(w2.over.winnerTeam, null, 'égalité parfaite');
});

test('un duel de bots contre un héros inactif se termine par le noyau, avant la limite de temps', () => {
  for (const seed of [1, 2, 3]) {
    const roster = [{ id: 'afk', hero: 'yeji', team: 'ally', controller: 'player', lane: 'top' }];
    ['yeji', 'sweetie', 'jennie'].forEach((h, i) => roster.push({ id: `e${i}`, hero: h, team: 'enemy', controller: 'bot', lane: ['top', 'bottom', null][i] }));
    const w = mk(roster, match, seed);
    run(w, 600000, true);
    assert.equal(w.over.reason, 'core', `seed ${seed}`);
    assert.ok(w.over.atMs < 600000 && w.over.atMs > 150000, `seed ${seed} : fin à ${w.over.atMs / 1000} s`);
  }
});

test('niveaux : à 8 minutes les héros des bots sont proches du niveau maximum', () => {
  const roster = [];
  for (const team of ['ally', 'enemy']) ['yeji', 'sweetie', 'jennie'].forEach((h, i) => roster.push({ id: `${team[0]}${i}`, hero: h, team, controller: 'bot', lane: ['top', 'bottom', null][i] }));
  const w = mk(roster, match, 1);
  run(w, 240000, true);
  const lv4 = w.heroes.reduce((a, h) => a + h.level, 0) / w.heroes.length;
  run(w, 240000, true);
  const lv8 = w.heroes.reduce((a, h) => a + h.level, 0) / w.heroes.length;
  assert.ok(lv4 >= 4.2 && lv4 <= 6.2, `niveau moyen à 4 min : ${lv4}`);
  assert.ok(lv8 >= 7 && lv8 <= 9, `niveau moyen à 8 min : ${lv8}`);
  // Le niveau 3 (ultime) arrive vers 2:00 en moyenne, pas dès la première minute.
  const w3 = mk(roster, match, 1);
  run(w3, 90000, true);
  assert.ok(w3.heroes.every((h) => h.rank.ult === 0), 'aucun ultime avant 1:30');
  run(w3, 90000, true);
  assert.ok(w3.heroes.filter((h) => h.rank.ult >= 1).length >= 4, 'la plupart ont leur ultime vers 3:00');
});

/* --------------------------- monstres des lignes et camps --------------------------- */

test('lignes : trois gnomes et un troll par vague ; la vague renforcée ajoute deux trolls', () => {
  assert.deepEqual(match.waves.composition, ['gnome', 'gnome', 'gnome', 'troll']);
  assert.deepEqual(match.boss.reinforced, ['troll', 'troll']);
  assert.equal(match.units.ranged, undefined, 'plus de sbire à distance : aucune planche fournie');
});

test('camps : une fleur et un dragon de chaque côté, chacun une grande unité et deux petites, symétriques', () => {
  const w = duo();
  run(w, 30400);
  for (const side of ['ally', 'enemy']) {
    const camps = w.camps.filter((c) => c.side === side);
    assert.deepEqual(camps.map((c) => c.kind).sort(), ['dragons', 'fleurs']);
    for (const c of camps) {
      const types = c.unitIds.map((id) => getUnit(w, id).monType);
      const fam = c.kind === 'fleurs' ? 'fleur' : 'dragon';
      assert.deepEqual(types, [`${fam}-large`, `${fam}-small`, `${fam}-small`]);
    }
  }
  for (const kind of ['fleurs', 'dragons']) {
    const a = w.camps.find((c) => c.side === 'ally' && c.kind === kind);
    const e = w.camps.find((c) => c.side === 'enemy' && c.kind === kind);
    assert.equal(a.x + e.x, map.width, 'miroir en x');
    assert.equal(a.y, e.y);
    const da = Math.hypot(a.x - map.spawns.ally.x, a.y - map.spawns.ally.y);
    const de = Math.hypot(e.x - map.spawns.enemy.x, e.y - map.spawns.enemy.y);
    assert.ok(Math.abs(da - de) < 1e-6, 'mêmes distances d\'accès pour les deux équipes');
    // positions des unités miroir aussi
    a.unitIds.forEach((id, i) => {
      const ua = getUnit(w, id);
      const ue = getUnit(w, e.unitIds[i]);
      assert.equal(Math.round(ua.x + ue.x), map.width);
      assert.equal(ua.y, ue.y);
    });
  }
});

test('camp : frapper un monstre fait riposter tout le camp', () => {
  const w = duo();
  run(w, 30400);
  const camp = w.camps.find((c) => c.side === 'ally' && c.kind === 'dragons');
  const a = getUnit(w, 'a');
  run(w, 5000);
  place(a, camp.x + 90, camp.y);
  issueCommand(w, 'a', { type: 'target', targetId: camp.unitIds[1] });
  run(w, 800);
  assert.ok(camp.unitIds.every((id) => getUnit(w, id).aggroId === 'a'), 'les trois monstres sont en combat');
  const other = camp.unitIds.map((id) => getUnit(w, id)).find((u) => u.monType === 'dragon-large');
  assert.ok(other, 'grand dragon présent');
});

/* ----------------------------------- cerbère ----------------------------------- */

function bossWorld() {
  const w = mk([
    { id: 'front', hero: 'sweetie', team: 'ally' },
    { id: 'behind', hero: 'sweetie', team: 'ally' },
    { id: 'side', hero: 'sweetie', team: 'ally' },
    { id: 'edge', hero: 'sweetie', team: 'ally' },
    { id: 'foe', hero: 'jennie', team: 'enemy' },
  ]);
  run(w, 211000);
  const boss = getUnit(w, w.boss.unitId);
  for (const id of ['front', 'behind', 'side', 'edge']) {
    const h = getUnit(w, id);
    h.hp = h.maxHp = 100000;
    h.def_ = 0;
  }
  return { w, boss };
}

test('cerbère · souffle : cône devant lui (35°, 320), départ à 510 ms, rien derrière ni hors cône', () => {
  const { w, boss } = bossWorld();
  const sp = match.units.boss.special;
  assert.equal(sp.hitMs, 510);
  const front = getUnit(w, 'front');
  place(front, boss.x + 250, boss.y); // cible : plein est
  place(getUnit(w, 'behind'), boss.x - 150, boss.y);
  place(getUnit(w, 'side'), boss.x + 200, boss.y + 260); // ~52° : hors du cône
  place(getUnit(w, 'edge'), boss.x + 260, boss.y + 100); // ~21° : dans le cône
  boss.aggroId = 'front';
  w.log.length = 0;
  run(w, 3000);
  const hits = w.log.filter((e) => e.type === 'special_hit').map((e) => e.targetId);
  assert.ok(hits.includes('front'));
  assert.ok(hits.includes('edge'), 'dans le cône');
  assert.ok(!hits.includes('behind'), 'rien derrière');
  assert.ok(!hits.includes('side'), 'rien hors du cône');
  const start = w.log.find((e) => e.type === 'special_start').t;
  const hit = w.log.find((e) => e.type === 'special_hit').t;
  assert.ok(Math.abs(hit - start - sp.hitMs) <= DT + 1, `impact ${hit - start} ms après le départ`);
  const dmg = w.log.find((e) => e.type === 'damage' && e.sourceId === boss.id && e.targetId === 'front');
  assert.ok(dmg);
});

test('cerbère : souffle toutes les 7 s au plus, morsure entre deux souffles', () => {
  const { w, boss } = bossWorld();
  place(getUnit(w, 'front'), boss.x + 100, boss.y);
  for (const id of ['behind', 'side', 'edge']) place(getUnit(w, id), 200, 200);
  boss.aggroId = 'front';
  w.log.length = 0;
  run(w, 16000);
  const starts = w.log.filter((e) => e.type === 'special_start').map((e) => e.t);
  assert.ok(starts.length >= 2);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= match.units.boss.special.cooldownMs - DT);
  const bites = w.log.filter((e) => e.type === 'hit' && e.heroId === boss.id).length;
  assert.ok(bites >= 3, 'la morsure continue entre les souffles');
});

/* --------------------- données : animations et règles synchronisées --------------------- */

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('animations des monstres : l\'impact tombe à la 4e image, la durée correspond aux règles', () => {
  const fams = match.sprites.families;
  for (const [id, def] of Object.entries(match.units)) {
    if (!def.sprite) continue;
    const fam = fams[def.sprite.family];
    assert.ok(fam, `${id} : famille ${def.sprite.family}`);
    const d = fam.attack.durationsMs;
    assert.equal(d.length, 6, id);
    assert.equal(sum(d.slice(0, 3)), def.auto.hitMs, `${id} : impact = début de la 4e image`);
    assert.equal(sum(d), def.auto.durationMs, `${id} : durée totale`);
    assert.ok(def.auto.intervalMs >= def.auto.durationMs, `${id} : la cadence laisse finir l'animation`);
  }
  const breath = fams.cerbere.breath.durationsMs;
  assert.equal(sum(breath.slice(0, 3)), match.units.boss.special.hitMs);
  assert.equal(sum(breath), match.units.boss.special.durationMs);
  assert.equal(fams.cerbere.flames.startMs, match.units.boss.special.hitMs);
});

test('planches : chaque fichier référencé existe', () => {
  const paths = [];
  for (const fam of Object.values(match.sprites.families)) for (const a of Object.values(fam)) if (a.sheet) paths.push(a.sheet);
  for (const def of Object.values(heroDefs)) {
    paths.push(def.sprites.companion.sheet, def.sprites.attack.sheet);
    for (const a of Object.values(def.sprites.abilities)) {
      if (a.sheet) paths.push(a.sheet);
      for (const v of Object.values(a)) if (typeof v === 'string' && v.startsWith('assets/')) paths.push(v);
    }
  }
  for (const p of paths) assert.ok(existsSync(new URL(p, root)), `introuvable : ${p}`);
});

test('animations des héros : la durée du lancer correspond à l\'animation fournie', () => {
  for (const [key, def] of Object.entries(heroDefs)) {
    for (const slot of ['skill', 'ult']) {
      const ab = def.abilities[slot];
      const frames = def.sprites.abilities[slot].frameDurationsMs;
      assert.equal(sum(frames), ab.lockMs, `${key} ${slot}`);
    }
  }
});

test('dégâts du souffle : même formule de Défense unique', () => {
  const sp = match.units.boss.special;
  assert.equal(mitigate(sp.damage, 30), Math.round((sp.damage * 100) / 130));
  const w = duo();
  const a = getUnit(w, 'a');
  const hp = a.hp;
  applyDamage(w, getUnit(w, 'b'), a, sp.damage);
  assert.equal(hp - a.hp, mitigate(sp.damage, a.def_));
});
