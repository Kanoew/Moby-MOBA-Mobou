import { createWorld, getUnit, issueCommand, step, TEAM_ALLY, TEAM_ENEMY } from './sim/world.js';
import { updateBot } from './sim/bot.js';
import { canCast } from './sim/abilities.js';
import { gainXp } from './sim/progression.js';
import { collectImagePaths, createRenderer, loadImages } from './render/renderer.js';
import { bindPointer, commandForPoint } from './input/pointer.js';
import { loadProfile, resetProfile, rewardMatch, saveProfile } from './ui/profile.js';
import { createUi } from './ui/screens.js';
import { createLobbyView, LOBBY_MS } from './ui/lobby.js';
import { attackAction, bindTouchControls, updateTouchHud } from './ui/touch.js';
import { createHud } from './ui/hud.js';
import { isMuted, setMuted, unlockAudio } from './ui/sound.js';

const STEP_MS = 16;
const PLAYER_ID = 'player';
const LANE_OF = { yeji: 'top', sweetie: 'bottom', jennie: null }; // Jennie alterne entre lignes, jungle et boss
const VERSION = window.APP_VERSION || 'dev';

// Paramètres d'URL (tests et réglages) :
//  ?hero=yeji|sweetie|jennie · ?mode=duel · ?bot=off · ?debug=1 · ?speed=N · ?seed=N · ?level=N · ?spend=1
//  ?touch=1 (force les commandes tactiles sur ordinateur) · ?reset=1 (efface le profil) · ?unlock=1 (tous les personnages)
//  Si hero ou mode est présent, la partie démarre directement (sans accueil).
const params = new URLSearchParams(location.search);
const touchMode = params.get('touch') === '1' || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
document.body.classList.toggle('touch', touchMode);

/** Si une version plus récente est publiée, recharge une fois la page (l'index en cache est alors périmé). */
async function checkVersion() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await r.json();
    if (version !== VERSION && sessionStorage.getItem('moba.reloaded') !== version) {
      sessionStorage.setItem('moba.reloaded', version);
      const u = new URL(location.href);
      u.searchParams.set('v', version);
      location.replace(u);
    }
  } catch {
    /* hors ligne : on garde la version chargée */
  }
}

const getJson = (p) => fetch(`${p}?v=${VERSION}`, { cache: 'no-cache' }).then((r) => r.json());

async function boot() {
  checkVersion();
  const [arena, map3v3, matchCfg, heroDefs, roster, itemsCfg] = await Promise.all(
    ['data/arena.json', 'data/map-3v3.json', 'data/match.json', 'data/heroes.json', 'data/roster.json', 'data/items.json'].map(getJson),
  );
  matchCfg.items = itemsCfg; // catalogue des douze objets et règles de la boutique
  const images = await loadImages(collectImagePaths(heroDefs, matchCfg));

  if (params.get('reset') === '1') resetProfile(localStorage);
  const profile = loadProfile(localStorage, roster);
  if (params.get('unlock') === '1') {
    profile.owned = roster.characters.map((c) => c.id);
    saveProfile(localStorage, profile);
  }

  const $ = (s) => document.querySelector(s);
  const canvas = $('#game');
  const status = $('#status');
  const app = $('#app');
  const helpEl = $('#help');
  helpEl.textContent = 'Clic : déplacer / verrouiller · Q : visée de la compétence (clic ou Q pour lancer, Échap annule) · R : ultime · 1 / 2 : +auto / +skill · S : stop · D : debug · N : rejouer · Échap : pause';

  const touchEls = {
    root: $('#touch'),
    zone: $('#stick-zone'),
    base: $('#stick-base'),
    knob: $('#stick-knob'),
    attack: $('#btn-attack'),
    skill: $('#btn-skill'),
    ult: $('#btn-ult'),
    plusAttack: $('#plus-attack'),
    plusSkill: $('#plus-skill'),
  };
  touchEls.root.hidden = !touchMode;

  const duel = params.get('mode') === 'duel';
  const speed = Math.max(1, Math.min(20, Number(params.get('speed')) || 1));
  const seed = Number(params.get('seed')) || 1;
  const botsOn = params.get('bot') !== 'off';
  let debugOn = params.get('debug') === '1';

  let game = null; // { world, renderer, hero, aim, paused, ended }
  let pointer = { x: 0, y: 0 };
  const me = () => (game ? getUnit(game.world, PLAYER_ID) : null);
  const issue = (cmd) => (game ? issueCommand(game.world, PLAYER_ID, cmd) : false);
  const hud = createHud({ issue, getGame: () => game, localId: PLAYER_ID, heroDefs });
  window.addEventListener('pointerdown', unlockAudio, { capture: true });

  function makeRoster(hero, picks) {
    if (duel) {
      const botHero = hero === 'yeji' ? 'jennie' : 'yeji';
      return [
        { id: PLAYER_ID, hero, team: TEAM_ALLY, controller: 'player' },
        { id: 'bot', hero: botHero, team: TEAM_ENEMY, controller: botsOn ? 'bot' : 'idle' },
      ];
    }
    // Match 3v3 : le joueur + deux bots contre trois bots, mêmes compagnons des deux côtés.
    // Les équipes viennent du lobby ; sans lobby (paramètres d'URL), les autres personnages alliés et le trio adverse.
    const allies = picks ? picks.allies : Object.keys(LANE_OF).filter((h) => h !== hero);
    const enemies = picks ? picks.enemies : Object.keys(LANE_OF);
    const out = [{ id: PLAYER_ID, hero, team: TEAM_ALLY, controller: 'player', lane: LANE_OF[hero] ?? null }];
    for (const h of allies) out.push({ id: `a-${h}`, hero: h, team: TEAM_ALLY, controller: 'bot', lane: LANE_OF[h] ?? null });
    for (const h of enemies) out.push({ id: `e-${h}`, hero: h, team: TEAM_ENEMY, controller: botsOn ? 'bot' : 'idle', lane: LANE_OF[h] ?? null });
    return out;
  }

  function startGame(hero, picks) {
    const world = createWorld({ map: duel ? arena : map3v3, heroDefs, match: duel ? null : matchCfg, roster: makeRoster(hero, picks), seed });
    const renderer = createRenderer(canvas, world, images, { touch: touchMode });
    renderer.setDebug(game ? game.renderer.isDebug() : debugOn);
    game = { world, renderer, hero, aim: null, paused: false, ended: false };
    const rendererEvents = world.onEvent;
    world.onEvent = (ev) => {
      if (rendererEvents) rendererEvents(ev);
      hud.onEvent(ev); // sons et messages de la boutique, de l'or et du rappel
    };
    hud.reset();
    $('#screen-game').classList.toggle('no-economy', duel);
    const lvl = Number(params.get('level'));
    if (!duel && lvl >= 2) {
      const p = getUnit(world, PLAYER_ID);
      gainXp(world, p, matchCfg.progression.levels[Math.min(lvl, 9) - 1]);
      if (params.get('spend') === '1') while (p.points > 0 && (issueCommand(world, PLAYER_ID, { type: 'level_up', slot: 'skill' }) || issueCommand(world, PLAYER_ID, { type: 'level_up', slot: 'auto' })));
    }
    status.hidden = true;
    $('#pause').hidden = true;
    $('#endcard').hidden = true;
    ui.go('game');
    window.__moba = { world, renderer, issueCommand, step, getUnit, PLAYER_ID, setAim: (a) => (game.aim = a), startGame, game: () => game };
    applyOrientation();
  }

  function quitToMenu() {
    if (game) issue({ type: 'steer', x: 0, y: 0 });
    game = null;
    ui.go('home');
  }

  /* ----- Paysage forcé sur mobile : pas de portrait ----- */
  async function lockLandscape() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* refusé : l'overlay de rotation prend le relais */
    }
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch {
      /* iOS Safari ne sait pas verrouiller : même repli */
    }
  }
  const rotateEl = $('#rotate');
  const isPortraitBlocked = () => touchMode && window.innerHeight > window.innerWidth;
  function applyOrientation() {
    const blocked = isPortraitBlocked();
    rotateEl.hidden = !blocked;
    if (blocked && game) issue({ type: 'steer', x: 0, y: 0 });
  }
  window.addEventListener('resize', applyOrientation);
  window.addEventListener('orientationchange', applyOrientation);

  /* ----- Interface ----- */
  // Lobby : 20 secondes pour choisir son personnage ; sans validation, le choix en cours est validé automatiquement.
  const lobby = createLobbyView({
    heroDefs,
    roster,
    toast: (t) => ui.toast(t),
    onCancel: () => {
      lobby.close();
      ui.go('home');
    },
    onStart: (result) => {
      profile.selected = result.playerHero;
      saveProfile(localStorage, profile);
      startGame(result.playerHero, result);
    },
  });
  const lobbyMs = Number(params.get('lobbyMs')) || LOBBY_MS;
  function openLobby() {
    if (touchMode) lockLandscape(); // dans le geste de l'utilisateur (le clic sur Jouer ou Rejouer)
    lobby.open(profile, { durationMs: lobbyMs });
    ui.go('lobby');
  }
  const ui = createUi({ roster, heroDefs, profile, storage: localStorage, onPlay: openLobby, version: VERSION });

  $('#btn-pause').addEventListener('click', () => setPaused(true));
  $('#btn-resume').addEventListener('click', () => setPaused(false));
  $('#btn-quit').addEventListener('click', () => {
    setPaused(false);
    quitToMenu();
  });
  $('#btn-again').addEventListener('click', () => {
    game = null;
    openLobby(); // « Rejouer » repasse par le lobby : on peut changer de personnage
  });
  $('#btn-menu').addEventListener('click', quitToMenu);
  function setPaused(p) {
    if (!game || game.ended) return;
    game.paused = p;
    $('#pause').hidden = !p;
    if (p) issue({ type: 'steer', x: 0, y: 0 });
  }

  /* ----- Commandes tactiles ----- */
  bindTouchControls(touchEls, {
    world: () => game.world,
    hero: me,
    issue,
    setAim: (a) => game && (game.aim = a),
    notify: (text) => hud.toast(text),
    enabled: () => !!game && !game.paused && !game.ended && !game.world.over && !me().dead && !isPortraitBlocked(),
  });

  /* ----- Souris / appui sur la carte ----- */
  const cast = (slot, p) => issue({ type: slot, x: p ? p.x : undefined, y: p ? p.y : undefined });
  function startAim() {
    if (game && game.world.match && canCast(game.world, me(), 'skill')) game.aim = { slot: 'skill' };
  }
  function hudAction(a) {
    if (a.type === 'level_up') issue(a);
    else if (a.type === 'bonus') issue({ type: 'choose_bonus_lane', lane: a.lane });
    else if (a.type === 'scores') hud.toggleScores();
    else if (a.type === 'cast-slot') {
      if (a.slot === 'ult') cast('ult');
      else if (game.aim) game.aim = null;
      else startAim();
    }
  }

  bindPointer(
    canvas,
    (cx, cy) => game.renderer.toWorld(cx, cy),
    (x, y, ev) => {
      if (!game || game.paused || game.world.over) return;
      const hud = game.renderer.hitHud(ev.clientX, ev.clientY);
      if (hud) {
        hudAction(hud);
        return;
      }
      if (me().dead) return;
      if (game.aim) {
        cast(game.aim.slot, { x, y });
        game.aim = null;
        return;
      }
      const cmd = commandForPoint(game.world, me(), x, y);
      // Sur écran tactile, le sol ne déplace pas (joystick) : un appui ne sert qu'à verrouiller un ennemi.
      if (touchMode && cmd.type === 'move') return;
      issue(cmd);
    },
  );
  canvas.addEventListener('pointermove', (e) => game && (pointer = game.renderer.toWorld(e.clientX, e.clientY)));
  canvas.addEventListener('contextmenu', () => game && (game.aim = null));

  window.addEventListener('keydown', (e) => {
    if (ui.screen() === 'lobby' && e.key === 'Escape') {
      lobby.close();
      ui.go('home');
      return;
    }
    if (!game || ui.screen() !== 'game') return;
    const k = e.key.toLowerCase();
    if (k === 'tab') {
      e.preventDefault();
      if (!e.repeat) hud.showScores(true); // maintenir Tab : tableau des scores
      return;
    }
    if (k === 'escape') {
      if (hud.isOverlayOpen()) hud.closeAll();
      else if (game.aim) game.aim = null;
      else setPaused(!game.paused);
      return;
    }
    if (game.paused) return;
    if (k === 'd') game.renderer.toggleDebug();
    else if (k === 'n') startGame(game.hero);
    else if (k === 's') issue({ type: 'stop' });
    else if (k === 'q') {
      if (game.aim) {
        cast('skill', pointer);
        game.aim = null;
      } else startAim();
    } else if (k === 'r') cast('ult');
    else if (k === 'b') issue({ type: 'recall' });
    else if (k === 'a') attackAction(game.world, me(), issue, (t) => hud.toast(t)); // touche A : même auto-cible que le bouton d'attaque
    else if (['c', 'v', 'x'].includes(k)) attackAction(game.world, me(), issue, (t) => hud.toast(t), { c: 'farm', v: 'hero', x: 'structure' }[k]);
    else if (k === 'p') hud.toggleShop();
    else if (k === '1' || k === '2') {
      const pending = game.world.bonus && game.world.bonus.choices.some((c) => c.chooserId === PLAYER_ID && !c.lane);
      if (pending) issue({ type: 'choose_bonus_lane', lane: k === '1' ? 'top' : 'bottom' });
      else issue({ type: 'level_up', slot: k === '1' ? 'auto' : 'skill' });
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Tab' && game) hud.showScores(false);
  });
  const closeTargetMenu = () => {
    $('#target-controls').classList.remove('open');
    $('#target-toggle').setAttribute('aria-expanded', 'false');
  };
  $('#target-toggle').addEventListener('click', () => {
    const open = $('#target-controls').classList.toggle('open');
    $('#target-toggle').setAttribute('aria-expanded', String(open));
  });
  $('#stick-zone').addEventListener('pointerdown', closeTargetMenu);
  $('#btn-pause').addEventListener('click', closeTargetMenu);
  document.querySelectorAll('[data-target-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!game || game.paused || game.ended || game.world.over || me().dead || ui.screen() !== 'game' || isPortraitBlocked()) return;
      attackAction(game.world, me(), issue, (t) => hud.toast(t), button.dataset.targetMode);
      closeTargetMenu();
    });
  });
  $('#btn-stop').addEventListener('click', () => {
    closeTargetMenu();
    if (game && !game.paused && !game.ended && !game.world.over && !isPortraitBlocked()) issue({ type: 'stop' });
  });
  $('#btn-shop-open').addEventListener('click', () => game && hud.toggleShop());
  $('#btn-scores').addEventListener('click', () => game && hud.toggleScores());
  $('#btn-recall').addEventListener('click', () => issue({ type: 'recall' }));
  const soundBtn = $('#btn-sound');
  const syncSound = () => (soundBtn.textContent = `Son : ${isMuted() ? 'coupé' : 'activé'}`);
  soundBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    syncSound();
  });
  syncSound();

  /* ----- Fin de partie : verdict, éclats gagnés ----- */
  function finish() {
    game.ended = true;
    const w = game.world;
    const outcome = w.over.winnerTeam === null ? 'draw' : w.over.winnerTeam === TEAM_ALLY ? 'win' : 'loss';
    const gain = duel ? 0 : rewardMatch(profile, roster, outcome);
    if (!duel) saveProfile(localStorage, profile);
    const title = $('#end-title');
    title.textContent = outcome === 'win' ? 'Victoire' : outcome === 'loss' ? 'Défaite' : 'Égalité';
    title.className = outcome;
    const m = Math.floor(w.over.atMs / 60000);
    const s = String(Math.floor(w.over.atMs / 1000) % 60).padStart(2, '0');
    $('#end-sub').textContent = `${w.over.reason === 'time' ? 'Temps écoulé' : 'Noyau détruit'} · ${m}:${s} · ${w.stats.ally.kills} / ${w.stats.enemy.kills} éliminations`;
    $('#end-reward').textContent = `+${gain}`;
    hud.closeAll();
    if (w.match) hud.renderEnd($('#end-table'));
    else $('#end-table').replaceChildren();
    $('#endcard').hidden = false;
    ui.renderHome();
  }

  /* ----- Boucle ----- */
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(100, now - last);
    last = now;
    if (ui.screen() === 'lobby') {
      lobby.tick(dt);
      return;
    }
    if (!game || ui.screen() !== 'game') return;
    const blocked = game.paused || isPortraitBlocked();
    if (!blocked) {
      acc += dt * speed;
      while (acc >= STEP_MS) {
        for (const h of game.world.heroes) if (h.controller === 'bot') updateBot(game.world, h, STEP_MS);
        step(game.world, STEP_MS);
        acc -= STEP_MS;
      }
    }
    const p = me();
    const aim = game.aim && (!game.world.match || p.dead || p.cast || !canCast(game.world, p, game.aim.slot)) ? null : game.aim;
    if (!aim) game.aim = null;
    game.renderer.draw(dt, PLAYER_ID, aim ? (aim.fromTouch ? aim : { slot: aim.slot, x: pointer.x, y: pointer.y }) : null);
    if (touchMode) updateTouchHud(touchEls, game.world, p);
    if (game.world.match) hud.update();
    if (game.world.over && !game.ended) finish();
  }
  requestAnimationFrame(frame);

  applyOrientation();
  if (params.get('hero') || params.get('mode')) startGame(params.get('hero') && heroDefs[params.get('hero')] ? params.get('hero') : profile.selected);
  else ui.go('home');
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error(err);
  const s = document.getElementById('status');
  s.hidden = false;
  s.textContent = `Erreur : ${err.message}`;
  document.getElementById('app').dataset.screen = 'game';
});
