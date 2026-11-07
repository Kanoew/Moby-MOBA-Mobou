// Écrans hors partie : accueil, personnages, boutique. Rend le DOM à partir des données (roster.json, heroes.json).
// Aucune image requise : le portrait vient de la planche du compagnon. Pour une illustration, renseigner `portrait`
// dans data/roster.json. Le style est dans styles/ui.css (variables et blocs « HABILLAGE »).
import { buyCharacter, saveProfile, selectCharacter } from './profile.js';

const v = (url) => (window.APP_VERSION ? `${url}?v=${window.APP_VERSION}` : url);
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function portrait(def, character, { big = false, locked = false } = {}) {
  const p = el('div', 'portrait');
  p.dataset.hero = character.id;
  if (character.portrait) {
    p.classList.add('art');
    p.style.backgroundImage = `url(${v(character.portrait)})`;
  } else {
    p.style.backgroundImage = `url(${v(def.sprites.companion.sheet)})`;
  }
  if (big) p.classList.add('big');
  if (locked) p.classList.add('locked-art');
  return p;
}

export function createUi({ roster, heroDefs, profile, storage, onPlay, version }) {
  const app = $('#app');
  let selectedInDetail = profile.selected;

  const saved = () => saveProfile(storage, profile);
  const def = (id) => heroDefs[id];
  const character = (id) => roster.characters.find((c) => c.id === id);

  function toast(text) {
    const t = el('div', 'toast', text);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function renderCoins() {
    for (const n of document.querySelectorAll('[data-bind="coins"], #home-coins')) n.textContent = String(profile.coins);
  }

  function renderHome() {
    renderCoins();
    $('#home-hero').textContent = def(profile.selected).name;
    $('#version-label').textContent = `v${version}`;
  }

  /* ----- Personnages ----- */
  function renderCharacters() {
    renderCoins();
    const grid = $('#char-grid');
    grid.replaceChildren();
    for (const c of roster.characters) {
      const owned = profile.owned.includes(c.id);
      const card = el('div', `card${c.id === profile.selected ? ' selected' : ''}${owned ? '' : ' locked'}`);
      card.setAttribute('role', 'listitem');
      card.dataset.hero = c.id;
      card.append(portrait(def(c.id), c, { locked: !owned }), el('div', 'name', def(c.id).name), el('div', 'role', def(c.id).role));
      if (c.id === profile.selected) card.append(el('span', 'tag', 'Choisi'));
      else if (!owned) card.append(el('span', 'tag', 'Verrouillé'));
      card.addEventListener('click', () => {
        selectedInDetail = c.id;
        renderCharacters();
      });
      grid.append(card);
    }
    renderDetail();
  }

  function renderDetail() {
    const box = $('#char-detail');
    box.replaceChildren();
    const c = character(selectedInDetail);
    const d = def(c.id);
    const owned = profile.owned.includes(c.id);
    box.append(portrait(d, c, { big: true, locked: !owned }), el('h3', '', d.name), el('p', 'blurb', c.blurb));
    const stats = el('div', 'stats');
    for (const [label, value] of [['PV', d.stats.hp], ['Attaque', d.stats.atk], ['Défense', d.stats.def], ['Vitesse', d.stats.speed], ['Portée', d.auto.range]]) {
      const s = el('div', 'stat', label);
      s.prepend(el('b', '', String(value)));
      stats.append(s);
    }
    const abil = el('div', 'abilities');
    const a1 = el('div', 'ability', 'Attaque');
    a1.append(el('small', '', d.auto.kind === 'melee' ? 'Mêlée' : 'Projectile à distance'));
    const a2 = el('div', 'ability', `Compétence · ${d.abilities.skill.name}`);
    a2.append(el('small', '', `Recharge ${d.abilities.skill.cooldownMs[0] / 1000} s`));
    const a3 = el('div', 'ability', `Ultime · ${d.abilities.ult.name}`);
    a3.append(el('small', '', `Recharge ${d.abilities.ult.cooldownMs[0] / 1000} s · niveau 3`));
    abil.append(a1, a2, a3);
    box.append(stats, abil);
    const btn = el('button', 'btn btn-primary');
    btn.type = 'button';
    if (!owned) {
      btn.textContent = `Dans la boutique · ${c.price} Éclats`;
      btn.classList.remove('btn-primary');
      btn.addEventListener('click', () => go('shop'));
    } else if (c.id === profile.selected) {
      btn.textContent = 'Personnage choisi';
      btn.disabled = true;
    } else {
      btn.textContent = 'Choisir ce personnage';
      btn.addEventListener('click', () => {
        selectCharacter(profile, c.id);
        saved();
        toast(`${d.name} choisie`);
        renderCharacters();
      });
    }
    box.append(btn);
  }

  /* ----- Boutique ----- */
  function renderShop() {
    renderCoins();
    const grid = $('#shop-grid');
    grid.replaceChildren();
    const ordered = [...roster.characters].sort((a, b) => Number(profile.owned.includes(a.id)) - Number(profile.owned.includes(b.id)));
    for (const c of ordered) {
      const owned = profile.owned.includes(c.id);
      const card = el('div', `card${owned ? '' : ' locked'}`);
      card.setAttribute('role', 'listitem');
      card.dataset.hero = c.id;
      card.append(portrait(def(c.id), c, { locked: !owned && false }), el('div', 'name', def(c.id).name), el('div', 'role', def(c.id).role));
      if (owned) {
        card.append(el('span', 'tag owned', 'Possédé'));
      } else {
        const price = el('div', 'price');
        price.append(el('i', 'coin'), document.createTextNode(String(c.price)));
        const buy = el('button', 'btn btn-primary', 'Acheter');
        buy.type = 'button';
        buy.disabled = profile.coins < c.price;
        buy.dataset.buy = c.id;
        buy.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = buyCharacter(profile, roster, c.id);
          if (r.ok) {
            saved();
            toast(`${def(c.id).name} rejoint votre équipe`);
          } else toast(`Achat impossible : ${r.reason}`);
          renderShop();
        });
        card.append(price, buy);
      }
      grid.append(card);
    }
    for (let i = 0; i < roster.comingSoon; i++) {
      const soon = el('div', 'card soon');
      soon.setAttribute('role', 'listitem');
      const p = el('div', 'portrait', '?');
      soon.append(p, el('div', 'name', 'À venir'), el('div', 'role', 'Prochain personnage'));
      grid.append(soon);
    }
  }

  /* ----- Navigation ----- */
  let current = 'home';
  function go(name) {
    current = name;
    app.dataset.screen = name;
    if (name === 'home') renderHome();
    else if (name === 'characters') {
      selectedInDetail = profile.selected;
      renderCharacters();
    } else if (name === 'shop') renderShop();
  }

  $('#btn-play').addEventListener('click', () => onPlay(profile.selected));
  $('#btn-characters').addEventListener('click', () => go('characters'));
  $('#btn-shop').addEventListener('click', () => go('shop'));
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => go(b.dataset.go));

  renderHome();
  return { go, screen: () => current, renderHome, toast };
}
