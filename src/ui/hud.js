// HUD en DOM pendant la partie : or et inventaire, boutique à trois onglets, tableau des scores, bouton de rappel.
// La simulation continue pendant que la boutique ou les scores sont ouverts ; leurs panneaux consomment les appuis
// (ils ne laissent rien passer jusqu'au canvas) et se ferment d'un geste (✕, fond, touche, ou relâcher Tab pour les scores).
// Le style est dans styles/ui.css ; les identifiants du DOM sont listés dans docs/ui-guide.md.
import { checkBuy, checkSell, inShopZone, sellValue } from '../sim/shop.js';
import { scoreRows } from './scoreboard.js';
import { play } from './sound.js';

const v = (url) => (window.APP_VERSION ? `${url}?v=${window.APP_VERSION}` : url);
const $ = (sel, root = document) => root.querySelector(sel);
const FAMILIES = [['physique', 'Physique'], ['tank', 'Tank'], ['magique', 'Magique']];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(item, cls = 'ico') {
  const i = el('img', cls);
  i.alt = item ? item.name : '';
  i.draggable = false;
  if (item) i.src = v(item.icon);
  return i;
}

/** Remplit `container` avec le tableau des scores : deux blocs de trois lignes (utilisé en partie et à l'écran de fin). */
export function renderScoreTable(container, data, heroDefs, catalog) {
  container.replaceChildren();
  for (const t of data.teams) {
    const block = el('div', `score-team ${t.isLocalTeam ? 'mine' : 'theirs'}`);
    const head = el('div', 'score-head');
    head.append(el('b', '', t.isLocalTeam ? '● Votre équipe' : '▲ Équipe adverse'), el('span', '', `${t.kills} éliminations · ${t.towers} tour${t.towers > 1 ? 's' : ''} détruite${t.towers > 1 ? 's' : ''}`));
    block.append(head);
    for (const r of t.rows) {
      const row = el('div', `score-row${r.local ? ' local' : ''}${r.dead ? ' dead' : ''}`);
      const p = el('span', 'mini-portrait');
      p.style.backgroundImage = `url(${v(heroDefs[r.key].sprites.companion.sheet)})`;
      const who = el('span', 'who', r.name);
      if (r.local) who.append(el('i', '', ' (vous)'));
      if (r.dead) who.append(el('small', '', r.respawnIn ? ` · ${r.respawnIn} s` : ' · éliminé'));
      const its = el('span', 'its');
      for (const id of r.items) {
        const it = id ? catalog.items.find((x) => x.id === id) : null;
        const slot = el('span', `slot${it ? '' : ' empty'}`);
        if (it) slot.append(icon(it));
        its.append(slot);
      }
      row.append(p, who, el('span', 'lv', `Niv ${r.level}`), el('span', 'kda', `${r.kills} / ${r.deaths} / ${r.assists}`), its);
      block.append(row);
    }
    container.append(block);
  }
}

export function createHud({ issue, getGame, localId, heroDefs }) {
  const els = {
    inventory: $('#inventory'),
    goldVal: $('#gold-val'),
    goldGain: $('#gold-gain'),
    slots: $('#inv-slots'),
    shop: $('#shop'),
    shopBackdrop: $('#shop-backdrop'),
    tabs: $('#shop-tabs'),
    list: $('#shop-list'),
    detail: $('#shop-detail'),
    shopGold: $('#shop-gold'),
    shopWhere: $('#shop-where'),
    scores: $('#scores'),
    scoresBody: $('#scores-body'),
    toast: $('#hud-toast'),
    recall: $('#btn-recall'),
  };
  let tab = 'physique';
  let selected = null;
  let shopOpen = false;
  let scoresOpen = false;
  let sigShop = '';
  let sigInv = '';
  let sigScores = '';
  let gainTimer = null;
  let toastTimer = null;
  // Après un achat, le bouton devient « Revendre » : sans garde, un double appui revendrait aussitôt l'objet.
  const ACTION_LOCK_MS = 700;
  let lockUntil = 0;
  let lastAction = null;

  const game = () => getGame();
  const world = () => game().world;
  const hero = () => world().byId.get(localId);
  const catalog = () => world().match.items;
  const itemOf = (id) => (id ? catalog().items.find((i) => i.id === id) : null);

  function toast(text) {
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 1800);
  }

  /* ----- inventaire (or + 3 emplacements) ----- */
  function renderInventory() {
    const h = hero();
    const sig = `${h.gold}|${h.items.join(',')}`;
    if (sig === sigInv) return;
    sigInv = sig;
    els.goldVal.textContent = String(h.gold);
    els.slots.replaceChildren();
    for (const id of h.items) {
      const it = itemOf(id);
      const b = el('button', `slot${it ? '' : ' empty'}`);
      b.type = 'button';
      b.title = it ? it.name : 'Emplacement libre';
      if (it) b.append(icon(it));
      b.addEventListener('click', () => {
        if (it) selected = it.id;
        if (it) tab = it.family;
        openShop();
      });
      els.slots.append(b);
    }
  }

  /* ----- boutique ----- */
  function openShop() {
    if (!world().match.items) return;
    shopOpen = true;
    scoresOpen = false;
    els.scores.hidden = true;
    els.shop.hidden = false;
    if (!selected) selected = catalog().items.find((i) => i.family === tab && i.starter).id;
    sigShop = '';
    renderShop();
  }
  function closeShop() {
    shopOpen = false;
    els.shop.hidden = true;
  }
  function toggleShop() {
    if (shopOpen) closeShop();
    else openShop();
  }

  function renderShop() {
    const w = world();
    const h = hero();
    const cat = catalog();
    const zone = inShopZone(w, h);
    const locked = performance.now() < lockUntil;
    const sig = [tab, selected, h.gold, h.items.join(','), zone, h.dead, h.starterBought, locked].join('|');
    if (sig === sigShop) return;
    sigShop = sig;

    els.shopGold.textContent = String(h.gold);
    els.shopWhere.textContent = h.dead
      ? 'Héros éliminé'
      : zone
        ? 'Vous êtes à la base'
        : h.starterBought
          ? 'Hors base · catalogue consultable'
          : 'Hors base · votre premier starter reste achetable ici';
    els.shopWhere.classList.toggle('away', !zone);

    for (const b of els.tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.family === tab);

    // Liste : starters en premier, puis les gros objets.
    els.list.replaceChildren();
    const inTab = cat.items.filter((i) => i.family === tab).sort((a, b) => Number(b.starter) - Number(a.starter));
    for (const it of inTab) {
      const owned = h.items.includes(it.id);
      const row = el('button', `row${it.id === selected ? ' selected' : ''}${owned ? ' owned' : ''}${it.starter ? ' starter' : ''}${h.gold < it.priceGold && !owned ? ' poor' : ''}`);
      row.type = 'button';
      row.dataset.item = it.id;
      row.append(icon(it), el('span', 'nm', it.name));
      if (it.starter) row.append(el('span', 'badge', 'Starter'));
      if (owned) row.append(el('span', 'badge owned', 'Équipé'));
      const price = el('span', 'pr');
      price.append(el('i', 'coin'), document.createTextNode(String(it.priceGold)));
      row.append(price);
      row.addEventListener('click', () => {
        selected = it.id;
        sigShop = '';
        renderShop();
      });
      els.list.append(row);
    }

    // Fiche : effet, or disponible, action, aperçu des trois emplacements.
    els.detail.replaceChildren();
    const it = itemOf(selected) || inTab[0];
    const owned = h.items.includes(it.id);
    const head = el('div', 'dhead');
    head.append(icon(it, 'ico big'), el('div', 'dtitle', it.name));
    head.lastChild.append(el('small', '', `${FAMILIES.find((f) => f[0] === it.family)[1]}${it.starter ? ' · starter' : ''}`));
    els.detail.append(head, el('p', 'desc', it.description));
    const facts = el('div', 'facts');
    const g = el('span', '', 'Or disponible : ');
    g.append(el('b', '', String(h.gold)));
    const p = el('span', '', owned ? 'Revente : ' : 'Prix : ');
    p.append(el('b', '', String(owned ? sellValue(w, it) : it.priceGold)));
    facts.append(g, p);
    els.detail.append(facts);
    const bonus = it.stats?.attack || 0;
    els.detail.append(el('p', 'desc', `Attaque : ${h.atk}${bonus ? ` → ${h.atk + (owned ? -bonus : bonus)} après ${owned ? 'revente' : 'achat'}` : ''} · Défense : ${h.def_}`));
    const r = owned ? checkSell(w, h, it.id) : checkBuy(w, h, it.id);
    const label = locked ? (lastAction === 'sell' ? 'Revendu ✓' : 'Acheté ✓') : owned ? `Revendre (+${sellValue(w, it)})` : `Acheter (${it.priceGold})`;
    const act = el('button', `btn ${owned && !locked ? '' : 'btn-primary'}`, label);
    act.type = 'button';
    act.id = 'shop-action';
    act.disabled = !r.ok || locked;
    act.addEventListener('click', () => {
      if (performance.now() < lockUntil) return; // second appui d'un double appui : ignoré
      lockUntil = performance.now() + ACTION_LOCK_MS;
      lastAction = owned ? 'sell' : 'buy';
      issue({ type: owned ? 'sell' : 'buy', itemId: it.id });
      sigShop = '';
      renderShop();
      setTimeout(() => {
        sigShop = '';
        if (shopOpen && game()) renderShop();
      }, ACTION_LOCK_MS + 20);
    });
    els.detail.append(act, el('div', `reason${r.ok ? '' : ' show'}`, r.reason));
    const prev = el('div', 'preview');
    for (const id of h.items) {
      const x = itemOf(id);
      const s = el('button', `slot${x ? '' : ' empty'}${x && x.id === it.id ? ' on' : ''}`);
      s.type = 'button';
      if (x) {
        s.append(icon(x));
        s.title = x.name;
        s.addEventListener('click', () => {
          selected = x.id;
          tab = x.family;
          sigShop = '';
          renderShop();
        });
      }
      prev.append(s);
    }
    els.detail.append(prev);
  }

  els.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-family]');
    if (!b) return;
    tab = b.dataset.family;
    selected = catalog().items.find((i) => i.family === tab && i.starter).id;
    sigShop = '';
    renderShop();
  });
  $('#shop-close').addEventListener('click', closeShop);
  els.shopBackdrop.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    closeShop();
  });
  els.inventory.querySelector('#inv-gold').addEventListener('click', openShop);

  /* ----- scores ----- */
  function showScores(on) {
    if (on === scoresOpen) return;
    scoresOpen = on;
    els.scores.hidden = !on;
    if (on) {
      closeShop();
      sigScores = '';
      renderScores();
    }
  }
  function renderScores() {
    const data = scoreRows(world(), localId);
    const sig = JSON.stringify(data.teams.map((t) => [t.kills, t.towers, t.rows.map((r) => [r.level, r.kills, r.deaths, r.assists, r.items, r.dead, r.respawnIn])]));
    if (sig === sigScores) return;
    sigScores = sig;
    renderScoreTable(els.scoresBody, data, heroDefs, catalog());
  }
  const toggleScores = () => showScores(!scoresOpen);
  $('#scores-backdrop').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    showScores(false);
  });

  /* ----- événements de la simulation ----- */
  function onEvent(ev) {
    const mine = ev.heroId === localId;
    if (!mine) return;
    switch (ev.type) {
      case 'item_bought':
        play('buy');
        break;
      case 'item_sold':
        play('sell');
        break;
      case 'shop_denied':
        play('deny');
        toast(ev.reason);
        break;
      case 'gold':
        els.goldGain.textContent = `+${ev.amount}`;
        els.goldGain.classList.remove('pop');
        void els.goldGain.offsetWidth;
        els.goldGain.classList.add('pop');
        clearTimeout(gainTimer);
        gainTimer = setTimeout(() => (els.goldGain.textContent = ''), 1100);
        break;
      case 'recall_complete':
        play('recall');
        toast('De retour à la base');
        break;
      case 'recall_cancel':
        play('cancel');
        toast(`Rappel interrompu · ${{ move: 'déplacement', damage: 'dégâts', cast: 'capacité', attack: 'attaque' }[ev.reason] || ev.reason}`);
        break;
      case 'level_up':
        play('level');
        break;
      default:
        break;
    }
  }

  /* ----- à chaque image ----- */
  function update() {
    if (!game() || !world().match) return;
    renderInventory();
    if (shopOpen) renderShop();
    if (scoresOpen) renderScores();
    const h = hero();
    const r = h.recall;
    els.recall.classList.toggle('active', !!r);
    els.recall.textContent = r ? `Rappel ${((r.durationMs - r.t) / 1000).toFixed(1)}` : 'Rappel';
    els.recall.disabled = h.dead || !!h.cast;
  }

  function reset() {
    closeShop();
    scoresOpen = false;
    els.scores.hidden = true;
    sigInv = '';
    sigShop = '';
    selected = null;
    tab = 'physique';
  }

  return {
    update,
    onEvent,
    openShop,
    closeShop,
    toggleShop,
    showScores,
    toggleScores,
    reset,
    toast,
    isOverlayOpen: () => shopOpen || scoresOpen,
    closeAll: () => {
      closeShop();
      showScores(false);
    },
    isShopOpen: () => shopOpen,
    isScoresOpen: () => scoresOpen,
    renderEnd: (container) => renderScoreTable(container, scoreRows(world(), localId), heroDefs, catalog()),
  };
}
