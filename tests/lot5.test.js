import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDamage, createWorld, edgeDistance, getUnit, issueCommand, step } from '../src/sim/world.js';
import { canCast } from '../src/sim/abilities.js';
import { gainXp } from '../src/sim/progression.js';
import { updateBot } from '../src/sim/bot.js';
import { attackAction, pickAttackTarget } from '../src/ui/touch.js';
import { pickSprite } from '../src/render/animator.js';
import {
  allyBotHeroes, createLobby, lobbyPick, lobbyRemaining, lobbyResult, lobbyTeams, lobbyTick, lobbyValidate, LAUNCH_DELAY_MS, LOBBY_MS,
} from '../src/ui/lobby.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(`data/${p}`, root), 'utf8'));
const baseMatch = load('match.json');
const items = load('items.json');
const flat = { ...baseMatch, items, progression: { ...baseMatch.progression, passiveXpPerSec: 0 } };
const full = { ...baseMatch, items };
const map = load('map-3v3.json');
const heroDefs = load('heroes.json');
const DT = 16;

const mk = (roster, m = flat, seed = 1) => {
  const w = createWorld({ map, heroDefs, match: m, roster, seed });
  w.log = [];
  w.onEvent = (e) => w.log.push(e);
  return w;
};
const duo = (a = 'yeji', b = 'jennie') => mk([{ id: 'a', hero: a, team: 'ally' }, { id: 'b', hero: b, team: 'enemy', controller: 'idle' }]);
const run = (w, ms, bots = false) => {
  for (let t = 0; t < ms; t += DT) {
    if (bots) for (const h of w.heroes) if (h.controller === 'bot') updateBot(w, h, DT);
    step(w, DT);
  }
};
const place = (u, x, y) => { u.x = x; u.y = y; };
const levelTo = (w, id, lvl) => { const h = getUnit(w, id); gainXp(w, h, baseMatch.progression.levels[lvl - 1] - h.xp); };

/* ------------------------- bouton d'attaque : auto-cible ------------------------- */

test('attaque : ordre explicite, le héros s\'approche d\'une cible hors de portée puis l\'attaque', () => {
  const w = duo();
  run(w, 5200);
  const a = getUnit(w, 'a');
  const b = getUnit(w, 'b');
  place(a, 1500, 450);
  place(b, 1500 + 420, 450); // bien au-delà de la portée de mêlée (140)
  assert.ok(edgeDistance(a, b) > a.def.auto.range * 2);
  assert.equal(issueCommand(w, 'a', { type: 'attack', targetId: 'b' }), true);
  run(w, 400);
  assert.ok(a.x > 1500 + 50, 'il avance');
  assert.equal(a.walking, true);
  run(w, 3000);
  assert.ok(edgeDistance(a, b) <= a.def.auto.range, 'arrêté à portée');
  assert.ok(b.hp < b.maxHp, 'les autos ont commencé');
});

test('attaque : un simple verrou (clic) ne poursuit toujours pas la cible', () => {
  const w = duo();
  run(w, 5200);
  const a = getUnit(w, 'a');
  place(a, 1500, 450);
  place(getUnit(w, 'b'), 1920, 450);
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  run(w, 2000);
  assert.equal(a.x, 1500);
  assert.equal(a.approach, false);
});

test('attaque : poursuite abandonnée par le joystick, un déplacement, stop, la fin du verrou, la mort ou le rappel', () => {
  const setups = {
    steer: (w) => issueCommand(w, 'a', { type: 'steer', x: 0, y: 1 }),
    move: (w) => issueCommand(w, 'a', { type: 'move', x: 1500, y: 600 }),
    stop: (w) => issueCommand(w, 'a', { type: 'stop' }),
    clear: (w) => issueCommand(w, 'a', { type: 'clear_target' }),
    lock: (w) => issueCommand(w, 'a', { type: 'target', targetId: 'b' }),
    recall: (w) => issueCommand(w, 'a', { type: 'recall' }),
    targetDies: (w) => applyDamage(w, getUnit(w, 'a'), getUnit(w, 'b'), 99999),
    heroDies: (w) => applyDamage(w, getUnit(w, 'b'), getUnit(w, 'a'), 99999),
  };
  for (const [name, act] of Object.entries(setups)) {
    const w = duo();
    run(w, 5200);
    const a = getUnit(w, 'a');
    place(a, 1500, 450);
    place(getUnit(w, 'b'), 1900, 450);
    issueCommand(w, 'a', { type: 'attack', targetId: 'b' });
    run(w, 200);
    assert.equal(a.approach, true, `${name} : en cours`);
    act(w);
    run(w, 50);
    assert.equal(a.approach, false, `${name} : poursuite arrêtée`);
  }
});

test('attaque : trop loin (au-delà de la distance de poursuite), le héros ne bouge pas', () => {
  const w = duo();
  run(w, 5200);
  const a = getUnit(w, 'a');
  place(a, 1000, 450);
  place(getUnit(w, 'b'), 1000 + baseMatch.attackAssist.maxChase + 200, 450);
  const scout = w.towers.find((t) => t.team === 'ally');
  place(scout, getUnit(w, 'b').x, getUnit(w, 'b').y); // vision partagée, poursuite toujours trop longue
  assert.equal(issueCommand(w, 'a', { type: 'attack', targetId: 'b' }), true);
  run(w, 1000);
  assert.equal(a.x, 1000);
  assert.equal(a.approach, false);
});

test('attaque : la poursuite contourne les obstacles (rocher, bloc central) et atteint la cible', () => {
  for (const [from, to] of [[[1100 - 80 - 26 - 40, 730], [1100 + 80 + 26 + 200, 730]], [[1500, 900], [2100, 900]]]) {
    const w = duo();
    run(w, 5200);
    const a = getUnit(w, 'a');
    const b = getUnit(w, 'b');
    place(a, ...from);
    place(b, ...to); // le second cas traverse le bloc rectangulaire en (1850, 900)
    issueCommand(w, 'a', { type: 'attack', targetId: 'b' });
    let minGapRock = Infinity;
    for (let t = 0; t < 6000; t += DT) {
      step(w, DT);
      minGapRock = Math.min(minGapRock, Math.hypot(a.x - 1100, a.y - 730) - 80 - a.radius);
    }
    assert.ok(edgeDistance(a, b) <= a.def.auto.range, `atteint la portée (${Math.round(edgeDistance(a, b))} px)`);
    assert.ok(b.hp < b.maxHp, 'a frappé');
    assert.ok(minGapRock >= -0.5, 'jamais dans le rocher');
  }
});

test('attaque : bloqué par un autre héros, le héros renonce au lieu de pousser sans fin', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'a2', hero: 'sweetie', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy', controller: 'idle' }]);
  run(w, 5200);
  const a = getUnit(w, 'a');
  place(a, 1500, 900);
  place(getUnit(w, 'b'), 2100, 900);
  issueCommand(w, 'a', { type: 'attack', targetId: 'b' });
  run(w, 8000);
  assert.ok(edgeDistance(a, getUnit(w, 'b')) <= a.def.auto.range || a.approach === false, 'arrivé ou renoncé, jamais coincé indéfiniment');
});

test('attaque : refusée sur un allié, un mort ou une structure protégée ; verrou refusé de même', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'a2', hero: 'sweetie', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy', controller: 'idle' }]);
  run(w, 5200);
  assert.equal(issueCommand(w, 'a', { type: 'attack', targetId: 'a2' }), false);
  assert.equal(issueCommand(w, 'a', { type: 'attack', targetId: 'tower-enemy-top-inner' }), false, 'tour intérieure protégée');
  const b = getUnit(w, 'b');
  applyDamage(w, getUnit(w, 'a'), b, 99999);
  assert.equal(issueCommand(w, 'a', { type: 'attack', targetId: 'b' }), false);
});

test('attaque : la course est animée pendant la poursuite', () => {
  const hero = { def: heroDefs.yeji, facing: { x: 1, y: 0 }, swing: null, cast: null, moveTarget: null, steer: null, walking: true, targetId: null };
  assert.equal(pickSprite(hero, 0).kind, 'running-right');
  assert.equal(pickSprite({ ...hero, walking: false }, 0).kind, 'idle');
});

test('bouton d\'attaque : préfère la proximité, respecte les filtres et stabilise le verrou à portée', () => {
  const w = duo();
  run(w, 5200);
  const a = getUnit(w, 'a');
  const b = getUnit(w, 'b');
  place(a, 1500, 900);
  place(b, 1500 + 550, 900); // héros ennemi à 550 px : loin de la portée de mêlée mais dans le rayon d'assistance
  w.pendingSpawns.push({ at: 0, team: 'enemy', lane: 'top', type: 'gnome' });
  run(w, DT);
  const g = [...w.units].reverse().find((u) => u.kind === 'minion');
  g.speed = 0;
  g.def = { ...g.def, ai: { aggro: 0, leash: 0 } };
  place(g, 1500 + 150, 900); // sbire bien plus proche
  assert.equal(pickAttackTarget(w, a).id, g.id, 'le sbire proche passe avant le héros distant');
  assert.equal(pickAttackTarget(w, a, undefined, 'hero').id, 'b');
  assert.equal(pickAttackTarget(w, a, undefined, 'farm').id, g.id);
  assert.equal(pickAttackTarget(w, a, undefined, 'structure'), null);
  b.invisible = true;
  assert.equal(pickAttackTarget(w, a).id, g.id, 'sans héros visible : le sbire');
  place(g, 1500 + 2000, 900);
  assert.equal(pickAttackTarget(w, a), null, 'rien dans le rayon');
  b.invisible = false;
  place(b, 1500 + 400, 900);
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  place(g, 1500 + 100, 900);
  assert.equal(pickAttackTarget(w, a).id, g.id, 'un verrou distant ne masque pas un sbire proche');
  place(b, 1600, 900);
  assert.equal(pickAttackTarget(w, a).id, 'b', 'le verrou à portée reste stable');
  assert.equal(pickAttackTarget(w, a, undefined, 'farm').id, g.id, 'farm ignore même un héros verrouillé');
  g.dead = true;
  assert.equal(pickAttackTarget(w, a, undefined, 'farm'), null, 'farm ne bascule pas vers un héros');
});

test('bouton d\'attaque : action complète (cible, ordre, message si aucun ennemi)', () => {
  const w = duo();
  run(w, 5200);
  const a = getUnit(w, 'a');
  place(a, 1500, 450);
  place(getUnit(w, 'b'), 1500 + 480, 450);
  const msgs = [];
  const issue = (c) => issueCommand(w, 'a', c);
  assert.equal(attackAction(w, a, issue, (m) => msgs.push(m)), true);
  assert.equal(a.targetId, 'b');
  assert.equal(a.approach, true);
  const w2 = duo();
  run(w2, 5200);
  place(getUnit(w2, 'a'), 300, 300);
  place(getUnit(w2, 'b'), 2900, 1500);
  const m2 = [];
  assert.equal(attackAction(w2, getUnit(w2, 'a'), (c) => issueCommand(w2, 'a', c), (m) => m2.push(m)), false);
  assert.deepEqual(m2, ['Aucun ennemi proche']);
});

/* --------------------------------- ultime --------------------------------- */

test('ultime : verrouillé avant le niveau 3, même avec des points ; automatique ensuite, sans point à y mettre', () => {
  const w = duo('sweetie');
  run(w, 5200);
  const a = getUnit(w, 'a');
  assert.deepEqual([a.level, a.rank.ult], [1, 0]);
  levelTo(w, 'a', 2);
  assert.equal(a.points, 1);
  assert.equal(a.rank.ult, 0, 'niveau 2 : toujours verrouillé');
  assert.equal(canCast(w, a, 'ult'), false);
  assert.equal(issueCommand(w, 'a', { type: 'ult' }), false);
  assert.equal(issueCommand(w, 'a', { type: 'level_up', slot: 'ult' }), false, 'on ne dépense pas de point sur l\'ultime');
  assert.equal(a.points, 1);
  levelTo(w, 'a', 3);
  assert.equal(a.rank.ult, 1, 'niveau 3 : rang 1, sans point dépensé');
  assert.equal(a.points, 1, 'le point reste disponible pour l\'auto ou le skill');
  assert.equal(canCast(w, a, 'ult'), true);
  levelTo(w, 'a', 6);
  assert.equal(a.rank.ult, 2);
  levelTo(w, 'a', 9);
  assert.equal(a.rank.ult, 3);
});

test('ultime : le niveau 3 n\'arrive pas dès la première minute', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy', controller: 'idle' }], full);
  run(w, 60000);
  assert.ok(getUnit(w, 'a').level < 3);
  assert.equal(getUnit(w, 'a').rank.ult, 0);
  assert.ok(baseMatch.progression.levels[2] >= 400, 'seuil du niveau 3 relevé (≈ 2:00 en jeu)');
});

/* ----------------------------------- IA ----------------------------------- */

const trio = (team, ctrl, extra = {}) => ['yeji', 'sweetie', 'jennie'].map((h, i) => ({ id: `${team[0]}${i}`, hero: h, team, controller: ctrl, lane: ['top', 'bottom', null][i], ...extra }));

test('IA : les bots ne restent plus inactifs (moins d\'un quart du temps hors de la base)', () => {
  const w = mk([...trio('ally', 'bot'), ...trio('enemy', 'bot')], full, 3);
  const idle = {};
  const alive = {};
  for (const h of w.heroes) { idle[h.id] = 0; alive[h.id] = 0; }
  let acc = 0;
  for (let t = 0; t < 240000; t += DT) {
    for (const h of w.heroes) updateBot(w, h, DT);
    step(w, DT);
    acc += DT;
    if (acc >= 200) {
      acc = 0;
      if (w.time < 6000) continue;
      for (const h of w.heroes) {
        const sp = w.map.spawns[h.team];
        if (h.dead || Math.hypot(h.x - sp.x, h.y - sp.y) < 240) continue;
        alive[h.id]++;
        if (!(h.moveTarget || h.steer || h.swing || h.cast || h.recall || h.targetId !== null)) idle[h.id]++;
      }
    }
  }
  for (const h of w.heroes) assert.ok(alive[h.id] > 100 && idle[h.id] / alive[h.id] < 0.25, `${h.id} : ${Math.round((100 * idle[h.id]) / alive[h.id])} % d'inactivité`);
});

test('IA : les deux camps bougent autant (les alliés du joueur ne restent pas en retrait)', () => {
  const roster = [{ id: 'player', hero: 'yeji', team: 'ally', controller: 'player', lane: 'top' }];
  for (const h of ['sweetie', 'jennie']) roster.push({ id: `a-${h}`, hero: h, team: 'ally', controller: 'bot', lane: h === 'sweetie' ? 'bottom' : null });
  for (const e of trio('enemy', 'bot')) roster.push(e);
  const w = mk(roster, full, 5);
  const dist = {};
  const last = {};
  for (const h of w.heroes) { dist[h.id] = 0; last[h.id] = { x: h.x, y: h.y }; }
  for (let t = 0; t < 180000; t += DT) {
    for (const h of w.heroes) if (h.controller === 'bot') updateBot(w, h, DT);
    step(w, DT);
    for (const h of w.heroes) { dist[h.id] += Math.hypot(h.x - last[h.id].x, h.y - last[h.id].y); last[h.id] = { x: h.x, y: h.y }; }
  }
  const mean = (pred) => { const xs = w.heroes.filter(pred).map((h) => dist[h.id]); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const allyBots = mean((h) => h.team === 'ally' && h.controller === 'bot');
  const enemyBots = mean((h) => h.team === 'enemy');
  assert.ok(allyBots > 0.6 * enemyBots, `alliés ${Math.round(allyBots)} px contre adversaires ${Math.round(enemyBots)} px`);
  assert.ok(allyBots > 4000, 'les alliés parcourent de la distance');
});

test('IA : un bot allié rejoint le combat du joueur (même cible que lui)', () => {
  const w = mk([
    { id: 'player', hero: 'yeji', team: 'ally', controller: 'player', lane: 'top' },
    { id: 'bot', hero: 'sweetie', team: 'ally', controller: 'bot', lane: 'bottom' },
    { id: 'foe', hero: 'jennie', team: 'enemy', controller: 'idle' },
  ], full);
  run(w, 6000, true);
  const p = getUnit(w, 'player');
  const bot = getUnit(w, 'bot');
  const foe = getUnit(w, 'foe');
  place(foe, 1600, 900);
  place(p, 1450, 900);
  place(bot, 1500, 1350); // loin du combat, mais pas à l'autre bout de la carte
  issueCommand(w, 'player', { type: 'attack', targetId: 'foe' });
  run(w, 4000, true);
  assert.equal(bot.targetId, 'foe', 'le bot attaque la cible du joueur');
  assert.ok(Math.hypot(bot.x - foe.x, bot.y - foe.y) < 700, 'et se rapproche');
});

test('IA : un bot défend quand un ennemi attaque nos structures', () => {
  const w = mk([
    { id: 'bot', hero: 'sweetie', team: 'ally', controller: 'bot', lane: 'bottom' },
    { id: 'foe', hero: 'jennie', team: 'enemy', controller: 'idle' },
  ], full);
  run(w, 6000, true);
  const bot = getUnit(w, 'bot');
  const foe = getUnit(w, 'foe');
  place(foe, 1000, 330); // près de la tour extérieure alliée du haut (1050, 219)
  place(bot, 1500, 1200);
  run(w, 2000, true);
  assert.equal(bot.targetId, 'foe');
});

test('IA : à l\'avantage numérique, les bots convergent vers une structure ennemie et la poussent', () => {
  const w = mk([...trio('ally', 'bot'), { id: 'e0', hero: 'yeji', team: 'enemy', controller: 'idle' }], full, 2);
  run(w, 65000, true);
  const e0 = getUnit(w, 'e0');
  e0.dead = true;
  e0.respawnAt = null; // l'adversaire est hors jeu
  let sawStructure = false;
  const towerHp = () => w.towers.filter((t) => t.team === 'enemy').reduce((a, t) => a + t.hp, 0);
  const before = towerHp();
  for (let t = 0; t < 90000 && !w.over; t += DT) {
    for (const h of w.heroes) if (h.controller === 'bot') updateBot(w, h, DT);
    step(w, DT);
    if (w.heroes.some((h) => h.team === 'ally' && h.targetId && ['tower', 'core'].includes(getUnit(w, h.targetId).kind))) sawStructure = true;
  }
  assert.ok(sawStructure, 'au moins un bot vise une tour ou le noyau');
  assert.ok(towerHp() < before - 1000 || w.over, 'les tours perdent des PV');
});

test('IA : un héros seul ne va pas affronter le Cerbère ; le duo se rassemble d\'abord', () => {
  const w = mk([
    { id: 'a-s', hero: 'sweetie', team: 'ally', controller: 'bot', lane: 'bottom' },
    { id: 'a-j', hero: 'jennie', team: 'ally', controller: 'bot', lane: null },
    { id: 'foe', hero: 'yeji', team: 'enemy', controller: 'idle' },
    { id: 'foe2', hero: 'sweetie', team: 'enemy', controller: 'idle' },
  ], { ...full, waves: { ...full.waves, firstMs: 1e9 } }); // 2 contre 2, sans vagues : ni poussée collective ni tir perdu sur le boss
  run(w, 214000, true);
  const boss = getUnit(w, w.boss.unitId);
  for (const id of ['a-s', 'a-j']) { levelTo(w, id, 5); getUnit(w, id).hp = getUnit(w, id).maxHp; }
  const sw = getUnit(w, 'a-s');
  sw.dead = true; // l'autre membre du duo est hors jeu : Jennie seule ne doit pas aller au boss
  sw.respawnAt = null;
  place(getUnit(w, 'a-j'), boss.x - 300, boss.y);
  run(w, 10000, true);
  assert.equal(boss.aggroId, null, 'personne n\'a frappé le boss seul');
  assert.equal(boss.hp, boss.maxHp);
  // Le duo au complet se retrouve au point de rendez-vous, puis engage ensemble.
  sw.dead = false;
  sw.hp = sw.maxHp;
  place(sw, boss.x - 480, boss.y);
  place(getUnit(w, 'a-j'), boss.x - 560, boss.y);
  run(w, 25000, true);
  assert.ok(boss.hp < boss.maxHp || boss.dead, 'le duo, rassemblé, attaque');
});

test('IA : sur toutes les graines, trois bots battent un héros inactif avant la limite de temps', () => {
  for (const seed of [1, 2, 3]) {
    const w = mk([{ id: 'afk', hero: 'yeji', team: 'ally', controller: 'player', lane: 'top' }, ...trio('enemy', 'bot')], full, seed);
    run(w, 600000, true);
    assert.equal(w.over.reason, 'core', `graine ${seed}`);
    assert.ok(w.over.atMs < 480000, `graine ${seed} : fin à ${Math.round(w.over.atMs / 1000)} s`);
  }
});

/* --------------------------------- lobby --------------------------------- */

const HEROES = ['yeji', 'sweetie', 'jennie'];
const mkLobby = (over = {}) => createLobby({ heroIds: HEROES, owned: ['yeji', 'sweetie'], selected: 'yeji', seed: 7, ...over });

test('lobby : 20 secondes, compte à rebours, validation automatique du choix en cours', () => {
  assert.equal(LOBBY_MS, 20000);
  const st = mkLobby();
  assert.equal(lobbyRemaining(st), 20);
  lobbyTick(st, 5000);
  assert.equal(lobbyRemaining(st), 15);
  lobbyPick(st, 'sweetie');
  lobbyTick(st, 14900);
  assert.equal(st.validated, false);
  assert.equal(lobbyRemaining(st), 1);
  lobbyTick(st, 200);
  assert.equal(st.validated, true);
  assert.equal(st.auto, true, 'validation automatique');
  assert.equal(st.picked, 'sweetie', 'c\'est le choix en cours qui est validé');
  assert.equal(st.done, false, 'une courte pause avant le lancement');
  lobbyTick(st, LAUNCH_DELAY_MS);
  assert.equal(st.done, true);
});

test('lobby : valider tout de suite arrête le minuteur et lance la partie après la pause', () => {
  const st = mkLobby();
  lobbyTick(st, 3000);
  assert.equal(lobbyValidate(st), true);
  assert.equal(lobbyValidate(st), false, 'une seule validation');
  assert.equal(lobbyRemaining(st), 0);
  assert.equal(st.auto, false);
  lobbyTick(st, LAUNCH_DELAY_MS - 1);
  assert.equal(st.done, false);
  lobbyTick(st, 2);
  assert.equal(st.done, true);
  const e = st.elapsed;
  lobbyTick(st, 5000);
  assert.equal(st.elapsed, e, 'plus rien ne bouge une fois terminé');
});

test('lobby : on ne choisit que ses personnages, et plus rien ne change après la validation', () => {
  const st = mkLobby();
  assert.equal(lobbyPick(st, 'jennie'), false, 'Jennie n\'est pas possédée');
  assert.equal(st.picked, 'yeji');
  assert.equal(lobbyPick(st, 'sweetie'), true);
  lobbyValidate(st);
  assert.equal(lobbyPick(st, 'yeji'), false);
  assert.equal(st.picked, 'sweetie');
  const odd = createLobby({ heroIds: HEROES, owned: ['jennie'], selected: 'yeji' });
  assert.equal(odd.picked, 'jennie', 'choix par défaut = un personnage possédé');
});

test('lobby : les bots choisissent aussi, jamais le même héros que le joueur dans l\'équipe', () => {
  const st = mkLobby();
  lobbyPick(st, 'sweetie');
  assert.deepEqual(allyBotHeroes(st).sort(), ['jennie', 'yeji']);
  lobbyPick(st, 'yeji');
  assert.deepEqual(allyBotHeroes(st).sort(), ['jennie', 'sweetie']);
  // au début ils « choisissent », puis verrouillent les uns après les autres
  const t0 = lobbyTeams(mkLobby());
  assert.ok(t0.allies[0].hero && t0.allies[0].human);
  assert.ok(t0.allies.slice(1).every((s) => s.hero === null), 'bots alliés en cours de choix');
  assert.ok(t0.enemies.every((s) => s.hero === null));
  const st2 = mkLobby();
  let prev = 0;
  for (let t = 0; t < 14000; t += 500) {
    lobbyTick(st2, 500);
    const n = lobbyTeams(st2).enemies.filter((s) => s.locked).length;
    assert.ok(n >= prev, 'un bot verrouillé le reste');
    prev = n;
  }
  assert.equal(prev, 3, 'les trois adversaires ont verrouillé avant la fin');
});

test('lobby : si le joueur change de personnage, un bot déjà verrouillé rechoisit', () => {
  const st = mkLobby();
  lobbyTick(st, 15000);
  assert.ok(lobbyTeams(st).allies.slice(1).every((s) => s.locked));
  lobbyPick(st, 'sweetie');
  assert.ok(lobbyTeams(st).allies.slice(1).some((s) => !s.locked), 'rechoix en cours');
  lobbyTick(st, 800);
  assert.ok(lobbyTeams(st).allies.slice(1).every((s) => s.locked));
});

test('lobby : le résultat donne le héros, deux alliés bots et trois adversaires, déterministe avec la graine', () => {
  const a = mkLobby({ seed: 11 });
  lobbyPick(a, 'sweetie');
  lobbyValidate(a);
  const r = lobbyResult(a);
  assert.equal(r.playerHero, 'sweetie');
  assert.equal(r.allies.length, 2);
  assert.ok(!r.allies.includes('sweetie'));
  assert.equal(r.enemies.length, 3);
  assert.deepEqual([...r.enemies].sort(), [...HEROES].sort());
  const b = mkLobby({ seed: 11 });
  lobbyPick(b, 'sweetie');
  lobbyValidate(b);
  assert.deepEqual(lobbyResult(b), r);
  assert.deepEqual(a.enemyLock, b.enemyLock, 'mêmes instants de verrouillage');
});

test('lobby : durée réglable pour les tests (?lobbyMs=)', () => {
  const st = mkLobby({ durationMs: 2000 });
  lobbyTick(st, 2100);
  assert.equal(st.validated, true);
});
