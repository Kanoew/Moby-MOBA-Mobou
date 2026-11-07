import { createWorld, getUnit, issueCommand, step, TEAM_ALLY, TEAM_ENEMY } from './sim/world.js';
import { updateBot } from './sim/bot.js';
import { canCast } from './sim/abilities.js';
import { gainXp } from './sim/progression.js';
import { collectImagePaths, createRenderer, loadImages } from './render/renderer.js';
import { bindPointer, commandForPoint } from './input/pointer.js';

const STEP_MS = 16;
const PLAYER_ID = 'player';
const LANE_OF = { yeji: 'top', sweetie: 'bottom', jennie: null }; // Jennie alterne entre lignes, jungle et boss

async function boot() {
  const [arena, map3v3, matchCfg, heroDefs] = await Promise.all(
    ['data/arena.json', 'data/map-3v3.json', 'data/match.json', 'data/heroes.json'].map((p) => fetch(p).then((r) => r.json())),
  );
  const images = await loadImages(collectImagePaths(heroDefs));

  // ?mode=duel : salle d'entraînement du lot 1 (Yeji vs Jennie, sans compétences).
  // ?hero=yeji|sweetie|jennie · ?bot=off (adversaires inertes) · ?debug=1 · ?speed=N · ?seed=N
  // ?level=N (XP pour atteindre le niveau N, pour tester) · ?spend=1 (dépense aussitôt tous les points)
  const params = new URLSearchParams(location.search);
  const duel = params.get('mode') === 'duel';
  const playerHero = heroDefs[params.get('hero')] ? params.get('hero') : 'yeji';
  const speed = Math.max(1, Math.min(20, Number(params.get('speed')) || 1));
  const seed = Number(params.get('seed')) || 1;
  const botsOn = params.get('bot') !== 'off';

  const canvas = document.getElementById('game');
  const status = document.getElementById('status');
  let world;
  let renderer;
  let aim = null; // { slot } pendant la visée d'une compétence
  let pointer = { x: 0, y: 0 };

  function roster() {
    if (duel) {
      const botHero = playerHero === 'yeji' ? 'jennie' : 'yeji';
      return [
        { id: PLAYER_ID, hero: playerHero, team: TEAM_ALLY, controller: 'player' },
        { id: 'bot', hero: botHero, team: TEAM_ENEMY, controller: botsOn ? 'bot' : 'idle' },
      ];
    }
    // Match 3v3 : le joueur + deux bots contre trois bots, mêmes compagnons des deux côtés.
    const out = [{ id: PLAYER_ID, hero: playerHero, team: TEAM_ALLY, controller: 'player', lane: LANE_OF[playerHero] }];
    for (const h of Object.keys(LANE_OF)) if (h !== playerHero) out.push({ id: `a-${h}`, hero: h, team: TEAM_ALLY, controller: 'bot', lane: LANE_OF[h] });
    for (const h of Object.keys(LANE_OF)) out.push({ id: `e-${h}`, hero: h, team: TEAM_ENEMY, controller: botsOn ? 'bot' : 'idle', lane: LANE_OF[h] });
    return out;
  }

  function newMatch() {
    world = createWorld({ map: duel ? arena : map3v3, heroDefs, match: duel ? null : matchCfg, roster: roster(), seed });
    const wasDebug = renderer ? renderer.isDebug() : params.get('debug') === '1';
    renderer = createRenderer(canvas, world, images);
    renderer.setDebug(wasDebug);
    aim = null;
    status.hidden = true;
    const lvl = Number(params.get('level'));
    if (!duel && lvl >= 2) {
      const me = getUnit(world, PLAYER_ID);
      gainXp(world, me, matchCfg.progression.levels[Math.min(lvl, 9) - 1]);
      if (params.get('spend') === '1') while (me.points > 0 && (issueCommand(world, PLAYER_ID, { type: 'level_up', slot: 'skill' }) || issueCommand(world, PLAYER_ID, { type: 'level_up', slot: 'auto' })));
    }
    window.__moba = { world, renderer, issueCommand, step, getUnit, PLAYER_ID, setAim: (a) => (aim = a) };
  }
  newMatch();

  const me = () => getUnit(world, PLAYER_ID);
  const cast = (slot, p) => issueCommand(world, PLAYER_ID, { type: slot, x: p ? p.x : undefined, y: p ? p.y : undefined });

  function startAim() {
    if (world.match && canCast(world, me(), 'skill')) aim = { slot: 'skill' };
  }

  function hudAction(a) {
    if (a.type === 'level_up') issueCommand(world, PLAYER_ID, a);
    else if (a.type === 'bonus') issueCommand(world, PLAYER_ID, { type: 'choose_bonus_lane', lane: a.lane });
    else if (a.type === 'cast-slot') {
      if (a.slot === 'ult') cast('ult');
      else if (aim) aim = null;
      else startAim();
    }
  }

  bindPointer(
    canvas,
    (cx, cy) => renderer.toWorld(cx, cy),
    (x, y, ev) => {
      if (world.over) return;
      const hud = renderer.hitHud(ev.clientX, ev.clientY);
      if (hud) {
        hudAction(hud);
        return;
      }
      if (me().dead) return;
      if (aim) {
        cast(aim.slot, { x, y });
        aim = null;
        return;
      }
      issueCommand(world, PLAYER_ID, commandForPoint(world, me(), x, y));
    },
  );
  canvas.addEventListener('pointermove', (e) => (pointer = renderer.toWorld(e.clientX, e.clientY)));
  canvas.addEventListener('contextmenu', () => (aim = null));

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'd') renderer.toggleDebug();
    else if (k === 'n') newMatch();
    else if (k === 's') issueCommand(world, PLAYER_ID, { type: 'stop' });
    else if (k === 'escape') aim = null;
    else if (k === 'q') {
      if (aim) {
        cast('skill', pointer);
        aim = null;
      } else startAim();
    } else if (k === 'r') cast('ult');
    else if (k === '1' || k === '2') {
      const pending = world.bonus && world.bonus.choices.some((c) => c.chooserId === PLAYER_ID && !c.lane);
      if (pending) issueCommand(world, PLAYER_ID, { type: 'choose_bonus_lane', lane: k === '1' ? 'top' : 'bottom' });
      else issueCommand(world, PLAYER_ID, { type: 'level_up', slot: k === '1' ? 'auto' : 'skill' });
    }
  });

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    acc += dt * speed;
    while (acc >= STEP_MS) {
      for (const h of world.heroes) if (h.controller === 'bot') updateBot(world, h, STEP_MS);
      step(world, STEP_MS);
      acc -= STEP_MS;
    }
    if (aim && (!world.match || me().dead || me().cast || !canCast(world, me(), aim.slot))) aim = null;
    renderer.draw(dt, PLAYER_ID, aim ? { slot: aim.slot, x: pointer.x, y: pointer.y } : null);
    if (world.over) {
      const won = world.over.winnerTeam === TEAM_ALLY;
      status.hidden = false;
      status.textContent = `${won ? 'Victoire' : 'Défaite'} · ${Math.floor(world.over.atMs / 60000)}:${String(Math.floor(world.over.atMs / 1000) % 60).padStart(2, '0')} · N pour rejouer`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = `Erreur : ${err.message}`;
});
