import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDamage, createWorld, getUnit, issueCommand, step } from '../src/sim/world.js';
import { buyCharacter, defaultProfile, loadProfile, rewardMatch, saveProfile, selectCharacter } from '../src/ui/profile.js';
import { aimFromDrag, autoAimPoint, nearestEnemyInRange, stickVector, STICK_DEAD } from '../src/ui/touch.js';
import { applyToHtml, bump, listModules } from '../tools/bump-version.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const load = (p) => JSON.parse(read(`data/${p}`));
const roster = load('roster.json');
const heroDefs = load('heroes.json');
const match = load('match.json');
const map = load('map-3v3.json');
const DT = 16;

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

/* --------------------------------- version --------------------------------- */

test('version : version.json, package.json et index.html disent la même chose', () => {
  const v = JSON.parse(read('version.json')).version;
  assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(read('package.json')).version, v);
  const html = read('index.html');
  assert.ok(html.includes(`window.APP_VERSION = "${v}"`), 'constante APP_VERSION');
  assert.ok(html.includes(`styles/ui.css?v=${v}`), 'feuille de style versionnée');
  assert.ok(html.includes(`src/main.js?v=${v}`), 'script d\'entrée versionné');
  assert.ok(html.includes(`manifest.webmanifest?v=${v}`), 'manifeste versionné');
});

test('version : la carte d\'import versionne CHAQUE module de src/ (sinon les modules importés restent en cache)', () => {
  const v = JSON.parse(read('version.json')).version;
  const html = read('index.html');
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  const modules = listModules();
  assert.ok(modules.length >= 10);
  for (const m of modules) assert.equal(map[m], `${m}?v=${v}`, `module non versionné : ${m}`);
  assert.deepEqual(Object.keys(map).sort(), [...modules].sort(), 'aucune entrée en trop');
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'la carte précède le premier module');
});

test('version : index.html est à jour avec le script (aucune dérive entre bump et fichier)', () => {
  const v = JSON.parse(read('version.json')).version;
  assert.equal(applyToHtml(read('index.html'), v, listModules()), read('index.html'));
});

test('version : règles d\'incrément', () => {
  assert.equal(bump('0.3.9', undefined), '0.3.10');
  assert.equal(bump('0.3.9', 'patch'), '0.3.10');
  assert.equal(bump('0.3.9', 'minor'), '0.4.0');
  assert.equal(bump('0.3.9', 'major'), '1.0.0');
  assert.equal(bump('0.3.9', '2.5.1'), '2.5.1');
  assert.equal(bump('0.3.9', 'sync'), '0.3.9');
  assert.throws(() => bump('x', 'patch'));
});

test('serveur de développement : types MIME des feuilles de style, icônes et manifeste', () => {
  const s = read('tools/serve.mjs');
  for (const ext of ['.css', '.svg', '.webmanifest', '.js', '.json', '.png']) assert.ok(s.includes(`'${ext}'`), ext);
  assert.ok(s.includes('no-cache'));
});

test('paysage forcé : manifeste, overlay de rotation et règle CSS', () => {
  const mf = JSON.parse(read('manifest.webmanifest'));
  assert.equal(mf.orientation, 'landscape');
  assert.equal(mf.display, 'fullscreen');
  assert.ok(read('index.html').includes('id="rotate"'));
  assert.ok(/orientation: portrait\) and \(pointer: coarse\)/.test(read('styles/ui.css')));
  assert.ok(read('src/main.js').includes("orientation.lock('landscape')"));
});

/* ---------------------------- profil, personnages, boutique ---------------------------- */

test('profil : le personnage de départ est possédé, les autres s\'achètent', () => {
  const p = defaultProfile(roster);
  assert.deepEqual(p.owned, ['yeji']);
  assert.equal(p.selected, 'yeji');
  assert.equal(p.coins, roster.currency.start);
  assert.equal(selectCharacter(p, 'sweetie'), false, 'on ne choisit pas un personnage non possédé');
  const r = buyCharacter(p, roster, 'sweetie');
  assert.equal(r.ok, true);
  assert.equal(p.coins, roster.currency.start - 300);
  assert.equal(selectCharacter(p, 'sweetie'), true);
  assert.equal(p.selected, 'sweetie');
});

test('boutique : refus sans changement si éclats insuffisants, déjà possédé ou inconnu', () => {
  const p = defaultProfile(roster);
  p.coins = 299;
  const before = JSON.stringify(p);
  assert.deepEqual(buyCharacter(p, roster, 'jennie'), { ok: false, reason: 'éclats insuffisants' });
  assert.equal(JSON.stringify(p), before);
  assert.equal(buyCharacter(p, roster, 'yeji').reason, 'déjà possédé');
  assert.equal(buyCharacter(p, roster, 'fantome').reason, 'inconnu');
  p.coins = 300;
  buyCharacter(p, roster, 'jennie');
  assert.equal(p.coins, 0);
  assert.equal(buyCharacter(p, roster, 'jennie').reason, 'déjà possédé', 'pas de double débit');
});

test('profil : sauvegarde et rechargement, données corrompues ou inconnues ignorées', () => {
  const st = memory();
  const p = defaultProfile(roster);
  buyCharacter(p, roster, 'jennie');
  selectCharacter(p, 'jennie');
  saveProfile(st, p);
  assert.deepEqual(loadProfile(st, roster), p);
  st.setItem('moba.profile.v1', '{pas du json');
  assert.deepEqual(loadProfile(st, roster), defaultProfile(roster));
  st.setItem('moba.profile.v1', JSON.stringify({ coins: -5, owned: ['fantome'], selected: 'fantome' }));
  const q = loadProfile(st, roster);
  assert.deepEqual(q.owned, ['yeji']);
  assert.equal(q.selected, 'yeji');
  assert.equal(q.coins, roster.currency.start);
  assert.deepEqual(loadProfile(null, roster), defaultProfile(roster), 'sans stockage');
});

test('récompenses de fin de partie : victoire > égalité > défaite', () => {
  const p = defaultProfile(roster);
  const c0 = p.coins;
  assert.equal(rewardMatch(p, roster, 'win'), roster.rewards.win);
  assert.equal(rewardMatch(p, roster, 'draw'), roster.rewards.draw);
  assert.equal(rewardMatch(p, roster, 'loss'), roster.rewards.loss);
  assert.ok(roster.rewards.win > roster.rewards.draw && roster.rewards.draw > roster.rewards.loss);
  assert.equal(p.coins, c0 + roster.rewards.win + roster.rewards.draw + roster.rewards.loss);
  assert.deepEqual([p.matches, p.wins], [3, 1]);
});

test('roster : chaque personnage proposé existe dans les données de jeu', () => {
  for (const c of roster.characters) assert.ok(heroDefs[c.id], c.id);
  assert.equal(roster.characters.filter((c) => c.starter).length, 1);
  assert.ok(roster.characters.every((c) => c.starter || c.price > 0));
});

/* ------------------------------- joystick et boutons ------------------------------- */

test('joystick : zone morte, vecteur unitaire, direction exacte', () => {
  assert.equal(stickVector(0, 0), null);
  assert.equal(stickVector(3, 2), null, 'dans la zone morte');
  const v = stickVector(30, 0);
  assert.deepEqual(v, { x: 1, y: 0 });
  const d = stickVector(-30, -30);
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9);
  assert.ok(d.x < 0 && d.y < 0);
  assert.ok(stickVector(56 * STICK_DEAD + 0.5, 0) !== null);
});

test('visée au glissement : appui simple = visée automatique, glisser = direction', () => {
  assert.equal(aimFromDrag(4, 3), null);
  assert.deepEqual(aimFromDrag(-40, 0), { x: -1, y: 0 });
});

function duelWorld(heroA = 'yeji', heroB = 'jennie') {
  const w = createWorld({ map, heroDefs, match, roster: [{ id: 'a', hero: heroA, team: 'ally' }, { id: 'b', hero: heroB, team: 'enemy' }] });
  for (let t = 0; t < 5200; t += DT) step(w, DT);
  return w;
}

test('commande « steer » : avance en continu à la vitesse du héros, s\'arrête au relâchement', () => {
  const w = duelWorld();
  const a = getUnit(w, 'a');
  a.x = 1000; a.y = 215;
  issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 });
  for (let t = 0; t < 1000; t += DT) step(w, DT);
  assert.ok(Math.abs(a.x - (1000 + a.speed * 1.0)) < a.speed * 0.03, `distance ${a.x - 1000}`);
  assert.ok(a.facing.x > 0.99);
  issueCommand(w, 'a', { type: 'steer', x: 0, y: 0 });
  const x = a.x;
  for (let t = 0; t < 300; t += DT) step(w, DT);
  assert.equal(a.x, x);
  assert.equal(a.steer, null);
});

test('steer : normalise la direction, respecte les obstacles, suspend les autos, cède à un clic', () => {
  const w = duelWorld();
  const a = getUnit(w, 'a');
  a.x = 1000; a.y = 730; // rocher en (1100, 730), rayon 80
  issueCommand(w, 'a', { type: 'steer', x: 5, y: 0 }); // longueur ≠ 1 : sans effet sur la vitesse
  for (let t = 0; t < 2000; t += DT) step(w, DT);
  assert.ok(a.x < 1100 - 80 - a.radius + 1, 'bloqué par le rocher');
  // suspend les autos : un coup en préparation est annulé
  issueCommand(w, 'a', { type: 'steer', x: 0, y: 0 }); // le joystick est relâché
  const b = getUnit(w, 'b');
  a.x = 1500; a.y = 215; b.x = 1560; b.y = 215;
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  for (let t = 0; t < 200; t += DT) step(w, DT);
  assert.ok(a.swing && !a.swing.hitDone);
  issueCommand(w, 'a', { type: 'steer', x: 0, y: 1 });
  assert.equal(a.swing, null, 'coup annulé avant l\'impact');
  // un ordre de déplacement remplace le joystick
  issueCommand(w, 'a', { type: 'move', x: 1500, y: 400 });
  assert.equal(a.steer, null);
});

test('steer : ignoré pendant un lancer, effacé à la mort, ralenti par une zone', () => {
  const w = duelWorld('sweetie');
  const a = getUnit(w, 'a');
  a.x = 1000; a.y = 215;
  a.rank.ult = 1; a.level = 3;
  issueCommand(w, 'a', { type: 'ult' });
  assert.equal(issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 }), false, 'un lancer en cours ne s\'interrompt pas');
  for (let t = 0; t < 600; t += DT) step(w, DT);
  issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 });
  a.slow = { frac: 0.5, until: w.time + 5000 };
  const x0 = a.x;
  for (let t = 0; t < 1000; t += DT) step(w, DT);
  assert.ok(Math.abs(a.x - x0 - a.speed * 0.5) < a.speed * 0.05, 'moitié de vitesse');
  assert.ok(a.steer);
  applyDamage(w, getUnit(w, 'b'), a, 99999);
  assert.ok(a.dead);
  assert.equal(a.steer, null, 'un héros mort ne continue pas d\'avancer');
});

test('bouton d\'attaque : l\'ennemi le plus proche à portée, pas hors de portée', () => {
  const w = duelWorld();
  const a = getUnit(w, 'a');
  const b = getUnit(w, 'b');
  a.x = 1000; a.y = 215;
  b.x = 1000 + a.radius + b.radius + a.def.auto.range + 40; b.y = 215; // juste hors de portée
  assert.equal(nearestEnemyInRange(w, a), null);
  b.x -= 60;
  assert.equal(nearestEnemyInRange(w, a).id, 'b');
});

test('bouton d\'attaque : un ennemi invisible ou un allié ne se verrouille pas', () => {
  const w = duelWorld();
  const a = getUnit(w, 'a');
  const b = getUnit(w, 'b');
  a.x = 1000; a.y = 215; b.x = 1080; b.y = 215;
  assert.ok(nearestEnemyInRange(w, a));
  b.invisible = true;
  assert.equal(nearestEnemyInRange(w, a), null);
});

test('skill d\'un appui : verrou en cours, sinon le plus proche, sinon le regard', () => {
  const w = duelWorld();
  const a = getUnit(w, 'a');
  const b = getUnit(w, 'b');
  a.x = 1000; a.y = 215; a.facing = { x: -1, y: 0 };
  b.x = 5000; b.y = 5000;
  const p0 = autoAimPoint(w, a);
  assert.ok(p0.x < a.x, 'sans ennemi : devant soi');
  b.x = 1200; b.y = 215;
  assert.deepEqual(autoAimPoint(w, a), { x: 1200, y: 215 });
  issueCommand(w, 'a', { type: 'target', targetId: 'b' });
  b.x = 1300;
  assert.deepEqual(autoAimPoint(w, a), { x: 1300, y: 215 }, 'le verrou prime');
});

test('animations : un héros dirigé au joystick joue la course', async () => {
  const { pickSprite } = await import('../src/render/animator.js');
  const hero = (over) => ({ def: heroDefs.yeji, facing: { x: 1, y: 0 }, swing: null, cast: null, moveTarget: null, steer: null, targetId: null, ...over });
  assert.equal(pickSprite(hero({}), 0).kind, 'idle');
  assert.equal(pickSprite(hero({ steer: { x: 1, y: 0 } }), 0).kind, 'running-right');
  assert.equal(pickSprite(hero({ steer: { x: -1, y: 0 }, facing: { x: -1, y: 0 } }), 0).kind, 'running-left');
});
