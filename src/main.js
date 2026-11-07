import { createWorld, getHero, issueCommand, step, TEAM_ALLY, TEAM_ENEMY } from './sim/world.js';
import { updateBot } from './sim/bot.js';
import { collectImagePaths, createRenderer, loadImages } from './render/renderer.js';
import { bindPointer, commandForPoint } from './input/pointer.js';

const STEP_MS = 16;
const PLAYER_ID = 'player';

async function boot() {
  const [map, heroDefs] = await Promise.all([
    fetch('data/map.json').then((r) => r.json()),
    fetch('data/heroes.json').then((r) => r.json()),
  ]);
  const images = await loadImages(collectImagePaths(heroDefs));

  // ?hero=yeji|jennie choisit le héros du joueur ; le bot prend l'autre.
  const params = new URLSearchParams(location.search);
  const playerHero = heroDefs[params.get('hero')] ? params.get('hero') : 'yeji';
  const botHero = playerHero === 'yeji' ? 'jennie' : 'yeji';
  const bot = params.get('bot') !== 'off';

  const canvas = document.getElementById('game');
  const status = document.getElementById('status');
  let world;
  let renderer;

  function newMatch() {
    world = createWorld({
      map,
      heroDefs,
      roster: [
        { id: PLAYER_ID, hero: playerHero, team: TEAM_ALLY, controller: 'player' },
        { id: 'bot', hero: botHero, team: TEAM_ENEMY, controller: bot ? 'bot' : 'idle' },
      ],
    });
    const wasDebug = renderer ? renderer.isDebug() : params.get('debug') === '1';
    renderer = createRenderer(canvas, world, images);
    renderer.setDebug(wasDebug);
    status.hidden = true;
    window.__moba = { world, renderer, issueCommand, step, getHero, PLAYER_ID };
  }
  newMatch();

  bindPointer(
    canvas,
    (cx, cy) => renderer.toWorld(cx, cy),
    (x, y) => {
      if (world.over) return;
      const me = getHero(world, PLAYER_ID);
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
    acc += dt;
    while (acc >= STEP_MS) {
      for (const h of world.heroes) if (h.controller === 'bot') updateBot(world, h, STEP_MS);
      step(world, STEP_MS);
      acc -= STEP_MS;
    }
    renderer.draw(dt, PLAYER_ID);
    if (world.over) {
      const won = world.over.winnerTeam === TEAM_ALLY;
      status.hidden = false;
      status.textContent = `${won ? 'Victoire' : 'Défaite'} · ${(world.over.atMs / 1000).toFixed(1)} s · R pour rejouer`;
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
