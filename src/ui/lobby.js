// Lobby de sélection : après « Jouer », 20 secondes pour choisir son personnage ; si personne ne valide, le choix
// en cours est validé automatiquement. Les bots choisissent aussi, à des instants tirés d'une graine.
// La logique (état, minuteur, choix, résultat) est pure et testée ; l'affichage (createLobbyView) vient par-dessus.
import { makeRng } from '../sim/world.js';
import { portrait } from './screens.js';

export const LOBBY_MS = 20000;
export const LAUNCH_DELAY_MS = 900; // pause d'affichage entre la validation et le début de la partie

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createLobby({ heroIds, owned, selected, seed = 1, durationMs = LOBBY_MS }) {
  const rng = makeRng(seed);
  const picked = owned.includes(selected) ? selected : owned[0];
  const lock = (n) => Array.from({ length: n }, () => Math.round(durationMs * (0.1 + 0.55 * rng())));
  return {
    heroIds: [...heroIds],
    owned: [...owned],
    durationMs,
    elapsed: 0,
    picked,
    validated: false,
    validatedAt: null,
    auto: false,
    done: false,
    allyLock: lock(2),
    enemyLock: lock(3),
    enemyOrder: shuffle(heroIds, rng).slice(0, 3),
  };
}

export function lobbyTick(st, dtMs) {
  if (st.done) return;
  st.elapsed += dtMs;
  if (!st.validated && st.elapsed >= st.durationMs) {
    st.validated = true; // personne n'a validé : on valide le choix en cours
    st.auto = true;
    st.validatedAt = st.durationMs;
  }
  if (st.validated && st.elapsed - st.validatedAt >= LAUNCH_DELAY_MS) st.done = true;
}

/** Choisit un personnage possédé. Les bots alliés, s'ils avaient déjà verrouillé, rechoisissent peu après. */
export function lobbyPick(st, id) {
  if (st.validated || !st.owned.includes(id)) return false;
  if (id !== st.picked) {
    st.picked = id;
    st.allyLock = st.allyLock.map((t) => Math.max(t, st.elapsed + 700));
  }
  return true;
}

export function lobbyValidate(st) {
  if (st.validated) return false;
  st.validated = true;
  st.validatedAt = st.elapsed;
  return true;
}

export const lobbyRemaining = (st) => (st.validated ? 0 : Math.max(0, Math.ceil((st.durationMs - st.elapsed) / 1000)));

/** Deux alliés bots : les autres personnages que celui du joueur (jamais le même héros deux fois dans une équipe). */
export const allyBotHeroes = (st) => st.heroIds.filter((id) => id !== st.picked).slice(0, 2);

/** Deux équipes de trois emplacements ; `hero` vaut null tant qu'un bot « choisit ». */
export function lobbyTeams(st) {
  const bots = allyBotHeroes(st);
  const ready = (t) => st.validated || st.elapsed >= t;
  return {
    allies: [
      { human: true, hero: st.picked, locked: st.validated },
      ...bots.map((h, i) => ({ human: false, hero: ready(st.allyLock[i]) ? h : null, locked: ready(st.allyLock[i]) })),
    ],
    enemies: st.enemyOrder.map((h, i) => ({ human: false, hero: ready(st.enemyLock[i]) ? h : null, locked: ready(st.enemyLock[i]) })),
  };
}

export const lobbyResult = (st) => ({ playerHero: st.picked, allies: allyBotHeroes(st), enemies: [...st.enemyOrder], auto: st.auto });

/* ------------------------------ affichage ------------------------------ */

const $ = (s) => document.querySelector(s);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createLobbyView({ heroDefs, roster, onStart, onCancel, toast }) {
  let st = null;
  let started = false;
  let sig = '';
  const picker = $('#lobby-picker');
  const timerEl = $('#lobby-timer');
  const barEl = $('#lobby-bar');
  const noteEl = $('#lobby-note');
  const okBtn = $('#lobby-validate');
  const character = (id) => roster.characters.find((c) => c.id === id);

  function slotCard(slot, mine) {
    const c = el('div', `slot-card${slot.human ? ' me' : ''}${slot.locked ? ' locked' : ''}${mine ? '' : ' foe'}`);
    if (slot.hero) {
      const d = heroDefs[slot.hero];
      const p = el('span', 'mini-portrait');
      p.style.backgroundImage = `url(${window.APP_VERSION ? `${d.sprites.companion.sheet}?v=${window.APP_VERSION}` : d.sprites.companion.sheet})`;
      const t = el('span', 'who', d.name);
      const sub = el('small', '', slot.human ? 'Vous' : 'Bot');
      t.append(sub);
      c.append(p, t, el('span', 'state', slot.locked ? '✓' : '…'));
    } else {
      c.append(el('span', 'mini-portrait empty'), el('span', 'who', 'Choisit…'), el('span', 'state', '…'));
    }
    return c;
  }

  function render() {
    const teams = lobbyTeams(st);
    const s = [st.picked, st.validated, lobbyRemaining(st), teams.allies.map((x) => x.hero).join(), teams.enemies.map((x) => x.hero).join()].join('|');
    if (s !== sig) {
      sig = s;
      picker.replaceChildren();
      for (const id of st.heroIds) {
        const d = heroDefs[id];
        const owned = st.owned.includes(id);
        const card = el('button', `card pick${id === st.picked ? ' selected' : ''}${owned ? '' : ' locked'}`);
        card.type = 'button';
        card.dataset.hero = id;
        card.disabled = st.validated && id !== st.picked;
        card.append(portrait(d, character(id), { locked: !owned }), el('div', 'name', d.name), el('div', 'role', d.role));
        if (id === st.picked) card.append(el('span', 'tag', st.validated ? 'Validé' : 'Choisi'));
        else if (!owned) card.append(el('span', 'tag', 'Boutique'));
        card.addEventListener('click', () => {
          if (!owned) {
            toast('Personnage verrouillé : à acheter dans la boutique');
            return;
          }
          lobbyPick(st, id);
        });
        picker.append(card);
      }
      const fill = (host, list, mine) => {
        host.replaceChildren(...list.map((x) => slotCard(x, mine)));
      };
      fill($('#lobby-allies'), teams.allies, true);
      fill($('#lobby-enemies'), teams.enemies, false);
    }
    const left = Math.max(0, st.durationMs - st.elapsed);
    timerEl.textContent = st.validated ? '✓' : String(lobbyRemaining(st));
    timerEl.classList.toggle('urgent', !st.validated && left < 5000);
    barEl.style.width = `${st.validated ? 100 : (100 * left) / st.durationMs}%`;
    okBtn.disabled = st.validated;
    okBtn.textContent = st.validated ? 'Prêt ✓' : 'Valider';
    noteEl.textContent = st.validated ? (st.auto ? 'Temps écoulé : choix validé automatiquement…' : 'Lancement de la partie…') : `Sans validation, ${heroDefs[st.picked].name} sera choisie dans ${lobbyRemaining(st)} s`;
  }

  okBtn.addEventListener('click', () => st && lobbyValidate(st));
  $('#lobby-back').addEventListener('click', () => {
    if (st) onCancel();
  });

  return {
    open(profile, { seed = Date.now() % 1000003, durationMs = LOBBY_MS } = {}) {
      st = createLobby({ heroIds: roster.characters.map((c) => c.id), owned: profile.owned, selected: profile.selected, seed, durationMs });
      started = false;
      sig = '';
      render();
    },
    tick(dtMs) {
      if (!st) return;
      lobbyTick(st, dtMs);
      render();
      if (st.done && !started) {
        started = true;
        const result = lobbyResult(st);
        st = null;
        onStart(result);
      }
    },
    close() {
      st = null;
    },
    state: () => st,
  };
}
