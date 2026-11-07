import { createWorld, getUnit, issueCommand, step, TEAM_ALLY, TEAM_ENEMY } from './sim/world.js';
import { updateBot } from './sim/bot.js';
import { collectImagePaths, createRenderer, loadImages } from './render/renderer.js';
import { bindPointer, commandForPoint } from './input/pointer.js';

const STEP_MS = 16;
const PLAYER_ID = 'player';
const LANE_OF = { yeji: 'top', sweetie: 'bottom', jennie: null }; // Jennie alterne entre les lignes

async function boot() {
  const [arena, map3v3, matchCfg, heroDefs] = await Promise.all(
    ['data/arena.json', 'data/map-3v3.json', 'data/match.json', 'data/heroes.json'].map((p) => fetch(p).then((r) => r.json())),
  );
  const images = await loadImages(collectImagePaths(heroDefs));

  // ?mode=duel : salle d'entraînement du lot 1 (Yeji vs Jennie).
  // ?hero=yeji|sweetie|jennie : héros du joueur · ?bot=off : adversaires inertes (duel) · ?debug=1 · ?speed=N · ?seed=N
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
    status.hidden = true;
    window.__moba = { world, renderer, issueCommand, step, getUnit, PLAYER_ID };
  }
  newMatch();

  bindPointer(
    canvas,
    (cx, cy) => renderer.toWorld(cx, cy),
    (x, y) => {
      if (world.over) return;
      const me = getUnit(world, PLAYER_ID);
      if (me.dead) return;
      issueCommand(world, PLAYER_ID, commandForPoint(world, me, x, y));
    },
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') renderer.toggleDebug();
    if (e.key === 'r' || e.key === 'R') newMatch();
    if (e.key === 's' || e.key === 'S') issueCommand(world, PLAYER_ID, { type: 'stop' });
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
    renderer.draw(dt, PLAYER_ID);
    if (world.over) {
      const won = world.over.winnerTeam === TEAM_ALLY;
      status.hidden = false;
      status.textContent = `${won ? 'Victoire' : 'Défaite'} · ${Math.floor(world.over.atMs / 60000)}:${String(Math.floor(world.over.atMs / 1000) % 60).padStart(2, '0')} · R pour rejouer`;
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
