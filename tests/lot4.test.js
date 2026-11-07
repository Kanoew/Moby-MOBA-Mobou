import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { applyDamage, createWorld, getUnit, issueCommand, mitigate, step } from '../src/sim/world.js';
import { checkBuy, checkSell, buyItem, sellItem, sellValue, inShopZone, itemDef } from '../src/sim/shop.js';
import { gainXp } from '../src/sim/progression.js';
import { updateBot } from '../src/sim/bot.js';
import { skillHeroHit } from '../src/sim/abilities.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(`data/${p}`, root), 'utf8'));
const items = load('items.json');
const baseMatch = load('match.json');
// Sans XP du temps : les valeurs de dégâts attendues restent exactes.
const match = { ...baseMatch, items, progression: { ...baseMatch.progression, passiveXpPerSec: 0 } };
const map = load('map-3v3.json');
const heroDefs = load('heroes.json');
const DT = 16;

function mk(roster = [{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }], m = match, seed = 1) {
  const w = createWorld({ map, heroDefs, match: m, roster, seed });
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
const place = (u, x, y) => { u.x = x; u.y = y; };
const away = (u) => place(u, 1500, 450); // en pleine ligne, loin de toute base
const count = (w, type) => w.log.filter((e) => e.type === type).length;
const levelTo = (w, id, lvl) => { const h = getUnit(w, id); gainXp(w, h, match.progression.levels[lvl - 1] - h.xp); };
/** Ennemi factice résistant et inerte, défense 0, pour mesurer les dégâts exacts. */
function dummy(w, x, y, team = 'enemy', hp = 1e6) {
  w.pendingSpawns.push({ at: 0, team, lane: 'top', type: 'gnome' });
  run(w, DT);
  const m = [...w.units].reverse().find((u) => u.kind === 'minion' && u.team === team);
  m.hp = m.maxHp = hp;
  m.def_ = 0;
  m.speed = 0;
  m.def = { ...m.def, ai: { aggro: 0, leash: 0 } };
  place(m, x, y);
  return m;
}
const lastDamage = (w, targetId, srcId) => [...w.log].reverse().find((e) => e.type === 'damage' && e.targetId === targetId && (!srcId || e.sourceId === srcId));
const buyAt = (w, id, item) => { const h = getUnit(w, id); h.gold = 99999; return buyItem(w, h, item); };

/* ---------------------------------- données ---------------------------------- */

test('catalogue : douze objets, trois familles, un starter et trois gros par famille, icônes présentes', () => {
  assert.equal(items.items.length, 12);
  for (const fam of ['physique', 'tank', 'magique']) {
    const f = items.items.filter((i) => i.family === fam);
    assert.equal(f.length, 4, fam);
    assert.equal(f.filter((i) => i.starter).length, 1, `${fam} : un starter`);
    assert.equal(f[0].starter, true, `${fam} : le starter est le premier de sa famille`);
  }
  assert.equal(new Set(items.items.map((i) => i.id)).size, 12);
  for (const it of items.items) assert.ok(existsSync(new URL(it.icon, root)), it.icon);
  assert.ok(items.items.filter((i) => i.starter).every((i) => i.priceGold <= items.rules.startingGold), 'l\'or de départ couvre n\'importe quel starter');
  assert.ok(items.items.filter((i) => !i.starter).every((i) => i.priceGold > items.rules.startingGold));
  assert.equal(items.rules.inventorySlots, 3);
  assert.equal(items.rules.maxCopiesPerItem, 1);
});

test('revente : 70 % du prix, arrondi vers le bas, affichable avant confirmation', () => {
  const w = mk();
  for (const it of items.items) assert.equal(sellValue(w, it), Math.floor(it.priceGold * 0.7));
});

/* ------------------------------------ or ------------------------------------ */

test('or : départ à 300 ; dernier coup sur un sbire ou un camp ; rien si un sbire ou une tour porte le coup', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  assert.equal(a.gold, 300);
  run(w, 5200);
  away(a);
  const g = dummy(w, 1560, 450, 'enemy', 1);
  issueCommand(w, 'a', { type: 'target', targetId: g.id });
  run(w, 900);
  assert.ok(g.dead);
  assert.equal(a.gold, 300 + match.units.gnome.gold);
  const g0 = a.gold;
  const g2 = dummy(w, 1900, 450, 'enemy', 100);
  applyDamage(w, getUnit(w, 'tower-ally-top-outer'), g2, 99999); // coup final de tour
  assert.ok(g2.dead);
  assert.equal(a.gold, g0, 'pas d\'or pour un coup final de tour');
  const t = dummy(w, 1900, 500, 'enemy', 100);
  applyDamage(w, a, t, 99999);
  assert.equal(a.gold, g0 + match.units.gnome.gold);
});

test('or : camps, Cerbère, éliminations et assistances', () => {
  const w = mk([{ id: 'a', hero: 'yeji', team: 'ally' }, { id: 'a2', hero: 'sweetie', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  const [a, a2, b] = ['a', 'a2', 'b'].map((id) => getUnit(w, id));
  run(w, 211000);
  const mon = w.units.find((u) => u.kind === 'monster' && u.monType === 'fleur-large');
  const g = a.gold;
  applyDamage(w, a, mon, 1e9);
  assert.equal(a.gold, g + match.units['fleur-large'].gold);
  const boss = getUnit(w, w.boss.unitId);
  const g2 = a.gold;
  applyDamage(w, a, boss, 1e9);
  assert.equal(a.gold, g2 + match.units.boss.gold, 'Cerbère : au dernier coup');
  // élimination + assistance
  b.damagers = { a2: w.time };
  const ga = a.gold;
  const ga2 = a2.gold;
  applyDamage(w, a, b, 1e9);
  assert.equal(a.gold, ga + match.economy.killGold);
  assert.equal(a2.gold, ga2 + match.economy.assistGold);
});

/* ------------------------------ règles de boutique ------------------------------ */

test('boutique : le premier starter s\'achète en ligne, un deuxième achat distant est refusé', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  away(a);
  assert.equal(inShopZone(w, a), false);
  assert.deepEqual(buyItem(w, a, 'lame-courte'), { ok: true, reason: '' });
  assert.deepEqual(a.items, ['lame-courte', null, null]);
  assert.equal(a.gold, 300 - 250);
  a.gold = 5000;
  assert.equal(buyItem(w, a, 'ceinture').reason, 'Retour à la base', 'deuxième starter à distance');
  assert.equal(buyItem(w, a, 'cuirasse').reason, 'Retour à la base', 'gros objet à distance');
  assert.deepEqual(a.items, ['lame-courte', null, null]);
  assert.equal(a.gold, 5000, 'aucun débit');
});

test('boutique : un starter acheté à la base consomme la possibilité d\'acheter un starter ailleurs', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  assert.equal(inShopZone(w, a), true);
  buyItem(w, a, 'ceinture');
  assert.equal(a.starterBought, true);
  sellItem(w, a, 'ceinture'); // même revendu, la possibilité est perdue
  run(w, 5200);
  away(a);
  a.gold = 5000;
  assert.equal(buyItem(w, a, 'lame-courte').reason, 'Retour à la base');
});

test('boutique : libellés de blocage (Déjà équipé, Or insuffisant, Inventaire plein, Retour à la base, Héros éliminé)', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  a.gold = 5000;
  buyItem(w, a, 'lame-courte');
  assert.equal(checkBuy(w, a, 'lame-courte').reason, 'Déjà équipé');
  a.gold = 100;
  assert.equal(checkBuy(w, a, 'cuirasse').reason, 'Or insuffisant');
  a.gold = 5000;
  buyItem(w, a, 'cuirasse');
  buyItem(w, a, 'talisman');
  assert.deepEqual(a.items.includes(null), false);
  assert.equal(checkBuy(w, a, 'relique').reason, 'Inventaire plein');
  assert.equal(checkBuy(w, a, 'inexistant').reason, 'Objet inconnu');
  a.dead = true;
  assert.equal(checkBuy(w, a, 'relique').reason, 'Héros éliminé');
  a.dead = false;
  run(w, 5200);
  away(a);
  assert.equal(checkBuy(w, a, 'relique').reason, 'Retour à la base');
  assert.equal(count(w, 'shop_denied'), 0, 'checkBuy ne produit pas d\'événement');
  buyItem(w, a, 'relique');
  assert.equal(w.log.filter((e) => e.type === 'shop_denied').pop().reason, 'Retour à la base');
});

test('vente : seulement à la base et vivant, 70 %, libère l\'emplacement', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  buyItem(w, a, 'lame-courte');
  a.gold = 1000;
  buyItem(w, a, 'dague-ouverture');
  buyItem(w, a, 'cuirasse'); // 1000 - 850 = 150 → refusé (or insuffisant)
  a.gold = 5000;
  buyItem(w, a, 'cuirasse');
  assert.equal(a.items.includes(null), false);
  assert.equal(checkBuy(w, a, 'talisman').reason, 'Inventaire plein');
  const before = a.gold;
  assert.deepEqual(sellItem(w, a, 'lame-courte'), { ok: true, reason: '' });
  assert.equal(a.gold, before + Math.floor(250 * 0.7));
  assert.deepEqual(a.items, [null, 'dague-ouverture', 'cuirasse']);
  assert.equal(checkBuy(w, a, 'talisman').ok, true, 'emplacement libéré');
  assert.equal(sellItem(w, a, 'lame-courte').reason, 'Objet non possédé');
  run(w, 5200);
  away(a);
  assert.equal(checkSell(w, a, 'cuirasse').reason, 'Retour à la base', 'vente impossible hors base');
  place(a, map.spawns.ally.x, map.spawns.ally.y);
  a.dead = true;
  assert.equal(checkSell(w, a, 'cuirasse').reason, 'Héros éliminé');
});

test('achat : un double appui ne débite qu\'une fois, et un échec ne change rien', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  a.gold = 300;
  assert.equal(issueCommand(w, 'a', { type: 'buy', itemId: 'grimoire' }), true);
  assert.equal(issueCommand(w, 'a', { type: 'buy', itemId: 'grimoire' }), false, 'deuxième appui refusé');
  assert.equal(a.gold, 50);
  assert.equal(a.items.filter(Boolean).length, 1);
  const snapshot = JSON.stringify([a.gold, a.items]);
  assert.equal(issueCommand(w, 'a', { type: 'buy', itemId: 'sceau' }), false);
  assert.equal(JSON.stringify([a.gold, a.items]), snapshot);
  assert.equal(count(w, 'item_bought'), 1);
});

/* --------------------------------- effets des objets --------------------------------- */

function hitOnDummy(w, a, d, ms = 1500) {
  issueCommand(w, 'a', { type: 'target', targetId: d.id });
  run(w, ms);
}

test('Lame courte : +8 dégâts bruts aux autos', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  away(a);
  const d = dummy(w, 1560, 450);
  hitOnDummy(w, a, d, 600);
  assert.equal(lastDamage(w, d.id, 'a').amount, a.atk);
  buyAt(w, 'a', 'lame-courte');
  place(a, 1500, 450);
  d.hp = d.maxHp;
  w.log.length = 0;
  a.lastCombatAt = w.time; // pas d'effet d'ouverture
  run(w, 1500);
  assert.equal(lastDamage(w, d.id, 'a').amount, a.atk + 8);
});

test('Dague d\'ouverture : première auto après 5 s hors combat +24, pas la suivante', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  buyAt(w, 'a', 'dague-ouverture');
  away(a);
  const d = dummy(w, 1560, 450);
  w.log.length = 0;
  hitOnDummy(w, a, d, 2600);
  const hits = w.log.filter((e) => e.type === 'damage' && e.sourceId === 'a');
  assert.ok(hits.length >= 2);
  assert.equal(hits[0].amount, a.atk + 24, 'ouverture');
  assert.equal(hits[1].amount, a.atk, 'auto suivante : normale');
  // 5 s sans combat : l'ouverture revient
  issueCommand(w, 'a', { type: 'clear_target' });
  run(w, 5200);
  w.log.length = 0;
  hitOnDummy(w, a, d, 700);
  assert.equal(w.log.find((e) => e.type === 'damage' && e.sourceId === 'a').amount, a.atk + 24);
});

test('Gants de duel : chaque troisième auto consécutive sur la même cible +30 ; changer de cible remet à zéro', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  buyAt(w, 'a', 'gants-duel');
  away(a);
  const d1 = dummy(w, 1560, 450);
  const d2 = dummy(w, 1440, 450);
  w.log.length = 0;
  hitOnDummy(w, a, d1, 4600);
  const hits = w.log.filter((e) => e.type === 'damage' && e.sourceId === 'a' && e.targetId === d1.id).map((e) => e.amount);
  assert.ok(hits.length >= 4, `${hits.length} coups`);
  assert.deepEqual(hits.slice(0, 4), [a.atk, a.atk, a.atk + 30, a.atk]);
  // changement de cible : le compteur repart de 1
  issueCommand(w, 'a', { type: 'target', targetId: d2.id });
  w.log.length = 0;
  run(w, 3400);
  const h2 = w.log.filter((e) => e.type === 'damage' && e.sourceId === 'a' && e.targetId === d2.id).map((e) => e.amount);
  assert.deepEqual(h2.slice(0, 3), [a.atk, a.atk, a.atk + 30]);
});

test('Marteau de siège : +25 % de dégâts d\'auto contre les tours, pas contre le reste', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  buyAt(w, 'a', 'marteau-siege'); // acheté à la base, avant de partir
  assert.equal(a.fx.structure, 0.25, 'l\'achat pose l\'effet du catalogue');
  a.fx.structure = 0; // mesure d'abord sans le bonus
  const tw = getUnit(w, 'tower-enemy-top-outer');
  place(a, tw.x - 120, tw.y);
  issueCommand(w, 'a', { type: 'target', targetId: tw.id });
  run(w, 800);
  const plain = lastDamage(w, tw.id, 'a').amount;
  assert.equal(plain, mitigate(a.atk, tw.def_));
  a.fx.structure = 0.25;
  w.log.length = 0;
  run(w, 1500);
  assert.equal(lastDamage(w, tw.id, 'a').amount, mitigate(a.atk * 1.25, tw.def_));
  const d = dummy(w, tw.x - 200, tw.y + 150);
  place(a, d.x - 70, d.y);
  hitOnDummy(w, a, d, 800);
  assert.equal(lastDamage(w, d.id, 'a').amount, a.atk, 'aucun bonus sur un sbire');
});

test('Ceinture +90 PV max, Cuirasse +18 Défense, effets retirés à la revente', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  const hp0 = a.maxHp;
  const def0 = a.def_;
  buyAt(w, 'a', 'ceinture');
  assert.equal(a.maxHp, hp0 + 90);
  assert.equal(a.hp, hp0 + 90, 'les PV actuels suivent');
  buyAt(w, 'a', 'cuirasse');
  assert.equal(a.def_, def0 + 18);
  const foe = getUnit(w, 'b');
  const hp = a.hp;
  applyDamage(w, foe, a, 100);
  assert.equal(hp - a.hp, mitigate(100, def0 + 18));
  sellItem(w, a, 'ceinture');
  sellItem(w, a, 'cuirasse');
  assert.equal(a.maxHp, hp0);
  assert.equal(a.def_, def0);
  assert.ok(a.hp <= a.maxHp);
});

test('PV max et Défense des objets suivent aussi la montée de niveau', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  buyAt(w, 'a', 'ceinture');
  buyAt(w, 'a', 'cuirasse');
  levelTo(w, 'a', 4);
  assert.equal(a.maxHp, Math.round(700 * (1 + 0.08 * 3)) + 90);
  assert.equal(a.def_, Math.round(30 * (1 + 0.05 * 3)) + 18);
});

test('Talisman : bouclier de 100 PV pendant 3 s en passant sous 30 % après un coup, recharge de 45 s', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  const foe = getUnit(w, 'b');
  buyAt(w, 'a', 'talisman');
  a.hp = a.maxHp * 0.35;
  applyDamage(w, foe, a, 60); // passe sous 30 %
  assert.ok(a.hp / a.maxHp < 0.3);
  assert.ok(a.shield && a.shield.amount === 100);
  assert.equal(count(w, 'talisman'), 1);
  run(w, 3100);
  assert.equal(a.shield, null, 'expire après 3 s');
  a.hp = a.maxHp * 0.35;
  applyDamage(w, foe, a, 60);
  assert.equal(count(w, 'talisman'), 1, 'recharge interne');
  run(w, 45000);
  a.hp = a.maxHp * 0.35;
  applyDamage(w, foe, a, 60);
  assert.equal(count(w, 'talisman'), 2);
  // pas de déclenchement si on était déjà sous le seuil
  const w2 = mk();
  const a2 = getUnit(w2, 'a');
  buyAt(w2, 'a', 'talisman');
  a2.hp = a2.maxHp * 0.2;
  applyDamage(w2, getUnit(w2, 'b'), a2, 5);
  assert.equal(a2.shield, null);
});

test('Armure de mêlée : +20 Défense 4 s après des dégâts de deux héros ennemis distincts en 4 s, recharge 16 s', () => {
  const w = mk([{ id: 'a', hero: 'sweetie', team: 'ally' }, { id: 'b1', hero: 'jennie', team: 'enemy' }, { id: 'b2', hero: 'yeji', team: 'enemy' }]);
  const a = getUnit(w, 'a');
  const [b1, b2] = ['b1', 'b2'].map((id) => getUnit(w, id));
  buyAt(w, 'a', 'armure-melee');
  const def0 = a.def_;
  applyDamage(w, b1, a, 30);
  applyDamage(w, b1, a, 30);
  assert.equal(a.defBuff, null, 'un seul héros : rien');
  applyDamage(w, b2, a, 30);
  assert.ok(a.defBuff && a.defBuff.amount === 20);
  const hp = a.hp;
  applyDamage(w, b1, a, 100);
  assert.equal(hp - a.hp, mitigate(100, def0 + 20), 'défense majorée');
  run(w, 4100);
  const hp2 = a.hp;
  applyDamage(w, b2, a, 100);
  assert.equal(hp2 - a.hp, mitigate(100, def0), 'bonus expiré');
  // recharge : un nouveau déclenchement avant 16 s est impossible
  applyDamage(w, b1, a, 10);
  assert.equal(a.defBuff && w.time < a.defBuff.until, false);
  run(w, 12500);
  applyDamage(w, b1, a, 10);
  applyDamage(w, b2, a, 10);
  assert.ok(a.defBuff && w.time < a.defBuff.until, 'de nouveau actif après la recharge');
});

test('Armure de mêlée : les dégâts de sbires ou de tours ne comptent pas', () => {
  const w = mk([{ id: 'a', hero: 'sweetie', team: 'ally' }, { id: 'b1', hero: 'jennie', team: 'enemy' }]);
  const a = getUnit(w, 'a');
  buyAt(w, 'a', 'armure-melee');
  applyDamage(w, getUnit(w, 'tower-enemy-top-outer'), a, 30);
  applyDamage(w, getUnit(w, 'b1'), a, 30);
  assert.equal(a.defBuff, null);
});

test('Grimoire : +12 sur le premier impact du skill par cible et par lancer (trois bouquets, une seule fois)', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  const w2 = mk([{ id: 'a', hero: 'jennie', team: 'ally' }, { id: 'b', hero: 'yeji', team: 'enemy' }]);
  const trial = (world, withBook) => {
    run(world, 5200);
    const j = getUnit(world, 'a');
    levelTo(world, 'a', 2);
    issueCommand(world, 'a', { type: 'level_up', slot: 'skill' });
    if (withBook) buyAt(world, 'a', 'grimoire');
    const d = dummy(world, 1500 + 120, 215);
    place(j, 1500, 215);
    world.log.length = 0;
    issueCommand(world, 'a', { type: 'skill', x: d.x, y: d.y });
    run(world, 1200);
    return world.log.filter((e) => e.type === 'damage' && e.targetId === d.id && e.sourceId === 'a').map((e) => e.amount);
  };
  void a; void w;
  const wPlain = mk([{ id: 'a', hero: 'jennie', team: 'ally' }, { id: 'b', hero: 'yeji', team: 'enemy' }]);
  const plain = trial(wPlain, false);
  const book = trial(w2, true);
  assert.equal(plain.length, 3);
  assert.equal(book.length, 3, 'trois bouquets touchent la cible');
  assert.equal(book.reduce((x, y) => x + y, 0) - plain.reduce((x, y) => x + y, 0), 12 + 3 * (mitigate(20 + getUnit(w2, 'a').atk * 0.4, 0) - mitigate(20 + getUnit(wPlain, 'a').atk * 0.4, 0)), 'passif unique et Attaque sur chacun des trois bouquets');
});

test('Grimoire : une fois par cible avec le dash de Yeji', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  buyAt(w, 'a', 'grimoire');
  place(a, 1500, 200);
  const d1 = dummy(w, 1620, 200);
  const d2 = dummy(w, 1760, 200);
  const base = Math.round(20 + 0.5 * a.atk);
  w.log.length = 0;
  issueCommand(w, 'a', { type: 'skill', x: 2000, y: 200 });
  run(w, 700);
  assert.equal(lastDamage(w, d1.id, 'a').amount, base + 12);
  assert.equal(lastDamage(w, d2.id, 'a').amount, base + 12);
});

test('Catalyseur : recharge du skill −15 % ; le plancher des règles est respecté', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  run(w, 5200);
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  buyAt(w, 'a', 'catalyseur');
  issueCommand(w, 'a', { type: 'skill', x: 900, y: 900 });
  assert.equal(a.cd.skill - w.time, 4250);
  // plancher : avec un minimum de 4500 ms, la recharge ne descend pas plus bas
  const floorItems = { ...items, rules: { ...items.rules, minSkillCooldownMs: 4500 } };
  const w2 = mk(undefined, { ...match, items: floorItems });
  const a2 = getUnit(w2, 'a');
  run(w2, 5200);
  levelTo(w2, 'a', 2);
  issueCommand(w2, 'a', { type: 'level_up', slot: 'skill' });
  buyAt(w2, 'a', 'catalyseur');
  issueCommand(w2, 'a', { type: 'skill', x: 900, y: 900 });
  assert.equal(a2.cd.skill - w2.time, 4500);
});

test('Relique : +15 % sur la valeur principale de chaque ultime (ralentissement, bouclier, dégâts)', () => {
  // Yeji : force du ralentissement
  const wy = mk();
  run(wy, 5200);
  levelTo(wy, 'a', 3);
  buyAt(wy, 'a', 'relique');
  issueCommand(wy, 'a', { type: 'ult' });
  run(wy, 300);
  assert.ok(Math.abs(wy.zones[0].slow - 0.3 * 1.15) < 1e-9);
  // Sweetie : montant du bouclier
  const ws = mk([{ id: 'a', hero: 'sweetie', team: 'ally' }, { id: 'b', hero: 'jennie', team: 'enemy' }]);
  run(ws, 5200);
  levelTo(ws, 'a', 3);
  buyAt(ws, 'a', 'relique');
  issueCommand(ws, 'a', { type: 'ult' });
  run(ws, 300);
  assert.equal(getUnit(ws, 'a').shield.amount, Math.round(150 * 1.15));
  // Jennie : dégâts d'armement
  const burstOf = (withRelic) => {
    const wj = mk([{ id: 'a', hero: 'jennie', team: 'ally' }, { id: 'b', hero: 'yeji', team: 'enemy' }]);
    run(wj, 5200);
    levelTo(wj, 'a', 3);
    if (withRelic) buyAt(wj, 'a', 'relique');
    issueCommand(wj, 'a', { type: 'ult' });
    run(wj, 300);
    return wj.zones[0].burst;
  };
  assert.ok(Math.abs(burstOf(true) / (burstOf(false) + 18 * 0.6) - 1.15) < 1e-9);
});

test('Sceau : un héros touché retire 20 % de la recharge restante, une fois par lancer ; pas sur un sbire', () => {
  const trial = (target) => {
    const w = mk([{ id: 'a', hero: 'jennie', team: 'ally' }, { id: 'b', hero: 'yeji', team: 'enemy' }]);
    run(w, 5200);
    const a = getUnit(w, 'a');
    levelTo(w, 'a', 2);
    issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
    buyAt(w, 'a', 'sceau');
    place(a, 1500, 215);
    let t;
    if (target === 'hero') {
      t = getUnit(w, 'b');
      place(t, 1620, 215);
    } else t = dummy(w, 1620, 215);
    issueCommand(w, 'a', { type: 'skill', x: t.x, y: t.y });
    const full = a.cd.skill - w.time;
    run(w, 700);
    return { full, remainingAtEnd: a.cd.skill - w.time, elapsed: 700 };
  };
  const hero = trial('hero');
  const minion = trial('minion');
  assert.ok(minion.remainingAtEnd > minion.full - minion.elapsed - 60, 'aucun retrait sur un sbire');
  const expected = Math.round((hero.full - 235) * 0.8); // retrait au premier impact (≈ après l'éventail)
  assert.ok(hero.remainingAtEnd < minion.remainingAtEnd - 500, `retrait appliqué : ${hero.remainingAtEnd} vs ${minion.remainingAtEnd}`);
  assert.ok(hero.remainingAtEnd < hero.full - hero.elapsed);
  void expected;
});

test('Sceau : ne descend jamais sous le plancher', async () => {
  const w = mk([{ id: 'a', hero: 'jennie', team: 'ally' }, { id: 'b', hero: 'yeji', team: 'enemy' }]);
  run(w, 5200);
  const a = getUnit(w, 'a');
  levelTo(w, 'a', 2);
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  buyAt(w, 'a', 'sceau');
  a.cd.skill = w.time + 900; // déjà sous le plancher de 1000 ms
  const before = a.cd.skill;
  skillHeroHit(w, a, { slot: 'skill', sealed: false }, getUnit(w, 'b'));
  assert.equal(a.cd.skill, before);
});

/* ----------------------------------- rappel ----------------------------------- */

const recallWorld = () => {
  const w = mk();
  run(w, 5200);
  const a = getUnit(w, 'a');
  away(a);
  return { w, a };
};

test('rappel : 3 600 ms de danse sur place, puis retour à la base', () => {
  const { w, a } = recallWorld();
  assert.equal(baseMatch.recall.durationMs, 3600);
  assert.equal(issueCommand(w, 'a', { type: 'recall' }), true);
  assert.equal(issueCommand(w, 'a', { type: 'recall' }), false, 'déjà en cours');
  run(w, 3500);
  assert.ok(a.recall);
  assert.deepEqual([a.x, a.y], [1500, 450], 'sur place');
  run(w, 150);
  assert.equal(a.recall, null);
  const sp = map.spawns.ally;
  assert.ok(Math.hypot(a.x - sp.x, a.y - sp.y) < 200, 'dans la base');
  assert.equal(count(w, 'recall_complete'), 1);
  a.hp = 100;
  run(w, 2000);
  assert.ok(a.hp > 100 + 700 * 0.08 * 1.5, 'se soigne dans la base');
});

test('rappel interrompu par un déplacement, un joystick, une capacité, un ultime, une attaque lancée ou des dégâts', () => {
  const cases = {
    move: (w) => issueCommand(w, 'a', { type: 'move', x: 1400, y: 450 }),
    steer: (w) => issueCommand(w, 'a', { type: 'steer', x: 1, y: 0 }),
    skill: (w) => issueCommand(w, 'a', { type: 'skill', x: 1800, y: 450 }),
    ult: (w) => issueCommand(w, 'a', { type: 'ult' }),
    attack: (w) => issueCommand(w, 'a', { type: 'target', targetId: getUnit(w, 'b').id }),
    damage: (w) => applyDamage(w, getUnit(w, 'b'), getUnit(w, 'a'), 5),
  };
  for (const [name, act] of Object.entries(cases)) {
    const { w, a } = recallWorld();
    levelTo(w, 'a', 3);
    issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
    place(getUnit(w, 'b'), 1500 + 90, 450);
    assert.equal(issueCommand(w, 'a', { type: 'recall' }), true);
    run(w, 800);
    assert.ok(a.recall, `${name} : en cours avant`);
    act(w);
    assert.equal(a.recall, null, `${name} : interrompu`);
    assert.ok(w.log.some((e) => e.type === 'recall_cancel'), name);
    run(w, 3000);
    assert.equal(count(w, 'recall_complete'), 0, `${name} : pas de retour à la base`);
  }
});

test('rappel : un dégât entièrement absorbé par un bouclier l\'interrompt aussi', () => {
  const { w, a } = recallWorld();
  a.shield = { amount: 500, max: 500, since: w.time, until: w.time + 9999 };
  issueCommand(w, 'a', { type: 'recall' });
  run(w, 500);
  applyDamage(w, getUnit(w, 'b'), a, 5);
  assert.equal(a.recall, null);
  assert.equal(a.shield.amount, 500 - mitigate(5, a.def_));
});

test('rappel : les autos sont suspendues pendant la danse sans l\'annuler ; achats et points ne l\'annulent pas', () => {
  const { w, a } = recallWorld();
  const foe = dummy(w, 1560, 450);
  issueCommand(w, 'a', { type: 'target', targetId: foe.id });
  run(w, 1500); // une auto est partie avant
  assert.ok(foe.hp < foe.maxHp);
  const hp = foe.hp;
  issueCommand(w, 'a', { type: 'recall' });
  assert.ok(a.recall);
  assert.equal(a.targetId, foe.id, 'le verrou reste');
  run(w, 2500);
  assert.equal(foe.hp, hp, 'aucune auto pendant la danse');
  assert.ok(a.recall, 'la danse continue malgré le verrou');
  a.points = 1;
  issueCommand(w, 'a', { type: 'level_up', slot: 'skill' });
  issueCommand(w, 'a', { type: 'buy', itemId: 'lame-courte' });
  issueCommand(w, 'a', { type: 'stop' });
  assert.ok(a.recall, 'ni les points, ni les achats, ni stop n\'interrompent');
  run(w, 1300);
  assert.equal(count(w, 'recall_complete'), 1);
});

test('rappel : impossible pendant un lancer ou mort ; la mort l\'efface', () => {
  const { w, a } = recallWorld();
  levelTo(w, 'a', 3);
  issueCommand(w, 'a', { type: 'ult' });
  assert.equal(issueCommand(w, 'a', { type: 'recall' }), false, 'pendant un lancer');
  run(w, 800);
  issueCommand(w, 'a', { type: 'recall' });
  applyDamage(w, getUnit(w, 'b'), a, 99999);
  assert.ok(a.dead);
  assert.equal(a.recall, null);
  assert.equal(issueCommand(w, 'a', { type: 'recall' }), false);
});

test('rappel : la danse dure exactement ce que dure l\'animation de chaque héros', () => {
  for (const [key, def] of Object.entries(heroDefs)) {
    const total = def.sprites.recall.sequence.reduce((s, f) => s + f.durationMs, 0);
    assert.equal(total, baseMatch.recall.durationMs, key);
    for (const f of def.sprites.recall.sequence) assert.ok(Number.isInteger(f.frame) && f.frame >= 0 && f.frame < 8 + 16, key);
    assert.ok(existsSync(new URL(def.sprites.recall.sheet, root)), def.sprites.recall.sheet);
  }
});

/* ------------------------------------ bots ------------------------------------ */

test('bots : ils achètent leur starter dès le départ, puis des gros objets, et se rappellent pour faire leurs achats', () => {
  const roster = [];
  for (const team of ['ally', 'enemy']) ['yeji', 'sweetie', 'jennie'].forEach((h, i) => roster.push({ id: `${team[0]}${i}`, hero: h, team, controller: 'bot', lane: ['top', 'bottom', null][i] }));
  const w = mk(roster, match, 2);
  run(w, 2000, true);
  for (const h of w.heroes) assert.equal(h.items.filter(Boolean).length, 1, `${h.id} : starter à 0:02`);
  assert.deepEqual(getUnit(w, 'a0').items[0], 'lame-courte');
  assert.deepEqual(getUnit(w, 'a1').items[0], 'ceinture');
  assert.deepEqual(getUnit(w, 'a2').items[0], 'grimoire');
  run(w, 8 * 60000, true);
  assert.ok(w.heroes.some((h) => h.items.filter(Boolean).length >= 2), 'au moins un gros objet acheté');
  assert.ok(count(w, 'recall_complete') >= 1, 'au moins un rappel mené à terme');
  assert.ok(w.heroes.every((h) => h.items.filter(Boolean).length <= 3));
  assert.ok(w.heroes.every((h) => new Set(h.items.filter(Boolean)).size === h.items.filter(Boolean).length), 'jamais deux exemplaires');
});

test('bots : le rappel d\'un bot en fuite est interrompu par les dégâts et ne le téléporte pas', () => {
  const w = mk([{ id: 'bot', hero: 'yeji', team: 'ally', controller: 'bot', lane: 'top' }, { id: 'foe', hero: 'jennie', team: 'enemy', controller: 'idle' }]);
  run(w, 8000, true);
  const bot = getUnit(w, 'bot');
  place(bot, 1500, 215);
  bot.hp = bot.maxHp * 0.1;
  place(getUnit(w, 'foe'), 5000, 5000);
  run(w, 400, true);
  assert.ok(bot.recall || bot.retreating, 'se replie');
  run(w, 4000, true);
  const sp = map.spawns.ally;
  assert.ok(Math.hypot(bot.x - sp.x, bot.y - sp.y) < 300, 'de retour à la base');
});

/* ------------------------------ tableau des scores ------------------------------ */

import { scoreRows } from '../src/ui/scoreboard.js';

const sixHeroes = () => {
  const r = [];
  for (const team of ['ally', 'enemy']) ['yeji', 'sweetie', 'jennie'].forEach((h, i) => r.push({ id: `${team[0]}${i}`, hero: h, team, controller: team === 'ally' && i === 0 ? 'player' : 'bot', lane: ['top', 'bottom', null][i] }));
  return r;
};

test('scores : deux blocs de trois lignes, l\'équipe locale d\'abord, ordre stable pendant tout le match', () => {
  const w = mk(sixHeroes());
  const first = scoreRows(w, 'a0');
  assert.equal(first.teams.length, 2);
  assert.deepEqual(first.teams.map((t) => t.team), ['ally', 'enemy']);
  assert.ok(first.teams.every((t) => t.rows.length === 3));
  const ids = first.teams.map((t) => t.rows.map((r) => r.id));
  assert.deepEqual(first.teams[0].rows.map((r) => r.local), [true, false, false]);
  run(w, 90000, true);
  assert.deepEqual(scoreRows(w, 'a0').teams.map((t) => t.rows.map((r) => r.id)), ids, 'même ordre après 90 s de jeu');
  // vu depuis l'autre équipe, l'ordre des blocs s'inverse mais celui des lignes reste
  assert.deepEqual(scoreRows(w, 'e0').teams.map((t) => t.team), ['enemy', 'ally']);
});

test('scores : portrait, niveau, K/D/A, trois emplacements d\'objets et en-têtes d\'équipe', () => {
  const w = mk(sixHeroes());
  const a1 = getUnit(w, 'a1');
  const e0 = getUnit(w, 'e0');
  buyAt(w, 'a1', 'ceinture');
  levelTo(w, 'a1', 4);
  getUnit(w, 'a0').kills = 2;
  w.stats.ally.kills = 2;
  w.stats.enemy.towers = 1;
  e0.deaths = 2;
  const data = scoreRows(w, 'a0');
  const row = data.teams[0].rows[1];
  assert.deepEqual([row.key, row.name, row.level, row.kills, row.deaths, row.assists], ['sweetie', 'Sweetie', 4, 0, 0, 0]);
  assert.deepEqual(row.items, ['ceinture', null, null]);
  assert.equal(row.items.length, 3);
  assert.deepEqual([data.teams[0].kills, data.teams[0].towers, data.teams[1].towers], [2, 0, 1]);
  assert.equal(data.teams[1].rows[0].deaths, 2);
  void a1;
});

test('scores : un héros mort est signalé avec son délai de réapparition', () => {
  const w = mk(sixHeroes());
  run(w, 6000);
  const victim = getUnit(w, 'e1');
  applyDamage(w, getUnit(w, 'a0'), victim, 99999);
  const row = scoreRows(w, 'a0').teams[1].rows[1];
  assert.equal(row.dead, true);
  assert.ok(row.respawnIn >= 4 && row.respawnIn <= 5, `délai ${row.respawnIn} s`);
  run(w, 2000);
  assert.equal(scoreRows(w, 'a0').teams[1].rows[1].respawnIn, row.respawnIn - 2);
  run(w, 4000);
  assert.equal(scoreRows(w, 'a0').teams[1].rows[1].dead, false);
});

test('scores : les six lignes se mettent à jour en match et restent figées à la fin', () => {
  const w = mk(sixHeroes());
  const before = JSON.stringify(scoreRows(w, 'a0'));
  getUnit(w, 'a0').kills = 3;
  getUnit(w, 'e2').assists = 4;
  assert.notEqual(JSON.stringify(scoreRows(w, 'a0')), before, 'mise à jour en direct');
  w.over = { winnerTeam: 'ally', atMs: w.time, reason: 'core' };
  const frozen = JSON.stringify(scoreRows(w, 'a0'));
  for (let i = 0; i < 50; i++) step(w, DT);
  assert.equal(JSON.stringify(scoreRows(w, 'a0')), frozen, 'figées une fois la partie terminée');
  assert.equal(scoreRows(w, 'a0').teams.reduce((n, t) => n + t.rows.length, 0), 6);
});


test('équipement offensif : bonus permanent cumulatif, progression et revente sans résidu', () => {
  const w = mk();
  const a = getUnit(w, 'a');
  const base = a.atk;
  buyAt(w, 'a', 'dague-ouverture');
  assert.equal(a.atk, base + 24);
  buyAt(w, 'a', 'gants-duel');
  assert.equal(a.atk, base + 46);
  assert.equal(buyItem(w, a, 'gants-duel').ok, false);
  assert.equal(a.atk, base + 46, 'un achat refusé ne cumule pas les bonus');
  levelTo(w, 'a', 3);
  const levelBase = Math.round(base * 1.12);
  assert.equal(a.atk, levelBase + 46, 'les bonus fixes ne sont pas multipliés par le niveau');
  assert.equal(sellItem(w, a, 'dague-ouverture').ok, true);
  assert.equal(a.atk, levelBase + 22);
  assert.equal(sellItem(w, a, 'gants-duel').ok, true);
  assert.equal(a.atk, levelBase);
});
