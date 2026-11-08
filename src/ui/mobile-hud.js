// Informations mobiles en DOM ; la mini-carte continue d'être dessinée par le renderer.
// Les lectures du monde se font après le dessin, une fois les positions interpolées restaurées.
const clamp = (v) => Math.max(0, Math.min(1, v));
const clock = (ms) => { const sec = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
export function mobileHudState(world, hero) {
  if (!world?.match || !hero) return null;
  const own = world.stats[hero.team], enemy = world.stats[hero.team === 'ally' ? 'enemy' : 'ally'];
  const levels = world.match.progression.levels, next = levels[hero.level], previous = levels[hero.level - 1];
  return {
    name: hero.def.name, level: hero.level, hp: Math.max(0, Math.ceil(hero.hp)), maxHp: hero.maxHp,
    health: clamp(hero.hp / Math.max(1, hero.maxHp)), xp: next == null ? 1 : clamp((hero.xp - previous) / Math.max(1, next - previous)),
    ownKills: own.kills, enemyKills: enemy.kills, ownTowers: own.towers, enemyTowers: enemy.towers,
    time: clock(world.time), objective: world.boss?.unitId ? 'Cerbère en jeu' : world.boss ? `Cerbère · ${clock(world.boss.spawnAt - world.time)}` : '',
    dead: hero.dead,
  };
}

export function createMobileHud({ root, canvas, enabled, getGame, localId, onScores }) {
  root.hidden = !enabled;
  const el = (id) => root.querySelector(`#${id}`);
  const nodes = Object.fromEntries(['hud-minimap', 'match-summary', 'mobile-vitals', 'hud-level', 'hud-hero-name', 'hud-health-text', 'hud-health', 'hud-health-fill', 'hud-xp', 'hud-xp-fill', 'hud-ally-kills', 'hud-enemy-kills', 'hud-ally-towers', 'hud-enemy-towers', 'hud-clock', 'hud-objective'].map((id) => [id, el(id)]));
  const saved = new Map();
  const change = (key, value, apply) => { if (saved.get(key) !== value) { saved.set(key, value); apply(value); } };
  const text = (id, value) => change(id, String(value), (v) => nodes[id].textContent = v);
  const attr = (id, name, value) => change(`${id}:${name}`, String(value), (v) => nodes[id].setAttribute(name, v));
  let layout = null;
  function measure() {
    if (!enabled) return;
    const rect = nodes['hud-minimap'].getBoundingClientRect(), c = canvas.getBoundingClientRect();
    if (rect.width > 0 && c.width > 0) {
      const summary = nodes['match-summary'].getBoundingClientRect();
      layout = { x: rect.left - c.left + 4, y: rect.top - c.top + 4, width: rect.width - 8, centerX: summary.left - c.left + summary.width / 2 };
    }
  }
  nodes['match-summary'].addEventListener('click', () => {
    const game = getGame();
    if (game && !game.paused && !game.ended && !game.world.over) onScores();
  });
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', measure);
  return {
    measure,
    layout: () => layout,
    update() {
      if (!enabled) return;
      const game = getGame(), hero = game?.world.byId.get(localId), state = mobileHudState(game?.world, hero);
      if (!state) return;
      text('hud-level', state.level); text('hud-hero-name', state.dead ? 'Éliminé' : state.name);
      text('hud-health-text', `${state.hp} / ${state.maxHp}`);
      text('hud-ally-kills', `● ${state.ownKills}`); text('hud-enemy-kills', `${state.enemyKills} ▲`);
      text('hud-ally-towers', `${state.ownTowers} tour${state.ownTowers > 1 ? 's' : ''}`); text('hud-enemy-towers', `${state.enemyTowers} tour${state.enemyTowers > 1 ? 's' : ''}`);
      text('hud-clock', state.time); text('hud-objective', state.objective);
      attr('match-summary', 'aria-label', `Ouvrir les scores : ${state.ownKills} à ${state.enemyKills} éliminations, ${state.time}, ${state.objective}`);
      attr('mobile-vitals', 'aria-label', `${state.name}, niveau ${state.level}, vie et progression`);
      attr('hud-level', 'aria-label', `Niveau ${state.level}`);
      attr('hud-health', 'aria-valuenow', state.hp); attr('hud-health', 'aria-valuemax', state.maxHp);
      attr('hud-xp', 'aria-valuenow', Math.round(state.xp * 100));
      change('health', state.health.toFixed(3), (v) => nodes['hud-health-fill'].style.setProperty('--health', v));
      change('xp', state.xp.toFixed(3), (v) => nodes['hud-xp-fill'].style.setProperty('--xp', v));
      change('dead', state.dead, (v) => nodes['mobile-vitals'].classList.toggle('dead', v));
      change('critical', !state.dead && state.health < 0.25, (v) => nodes['mobile-vitals'].classList.toggle('critical', v));
    },
  };
}
