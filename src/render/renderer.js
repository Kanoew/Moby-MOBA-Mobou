// Rendu canvas : lit l'état de simulation, ne le modifie jamais.
// Les sbires, tours et noyaux sont dessinés de façon procédurale (aucun sprite fourni pour l'instant).
import { VISION_RADII, pointVisibleTo, unitVisibleTo, visionSources } from '../sim/vision.js';
import { play } from '../ui/sound.js';
import { edgeDistance, getUnit, isVulnerable } from '../sim/world.js';
import { directionFromFacing, frameAt, pickSprite } from './animator.js';
import { cooldownLeft } from '../sim/abilities.js';
import { xpToNext } from '../sim/progression.js';

const COLORS = {
  ally: '#34d3e8',
  enemy: '#ff6f61',
  ground: '#173438',
  grid: 'rgba(255,255,255,0.04)',
  lane: '#425453',
  obstacle: '#294448',
  obstacleEdge: '#6b8580',
  ink: '#f4f1e8',
  gold: '#ffd36b',
};
const VIEW_H = 900; // hauteur visible en unités monde (mode match)

export function loadImages(paths) {
  const out = {};
  return Promise.all(
    [...new Set(paths)].map(
      (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            out[src] = img;
            resolve();
          };
          img.onerror = () => reject(new Error(`image introuvable : ${src}`));
          img.src = window.APP_VERSION ? `${src}?v=${window.APP_VERSION}` : src; // numéro de version : force le rafraîchissement du cache
        }),
    ),
  ).then(() => out);
}

export function collectImagePaths(heroDefs, match) {
  const paths = [];
  if (match && match.sprites) {
    for (const fam of Object.values(match.sprites.families)) {
      for (const a of Object.values(fam)) if (a.sheet) paths.push(a.sheet);
    }
  }
  for (const d of Object.values(heroDefs)) {
    paths.push(d.sprites.companion.sheet, d.sprites.attack.sheet);
    if (d.sprites.attack.projectile) paths.push(d.sprites.attack.projectile.texture);
    if (d.sprites.recall) paths.push(d.sprites.recall.sheet);
    for (const a of Object.values(d.sprites.abilities || {})) {
      if (a.sheet) paths.push(a.sheet);
      // Textures d'effets : toute valeur de chemin dans le bloc fx.
      for (const v of Object.values(a)) if (typeof v === 'string' && v.startsWith('assets/')) paths.push(v);
    }
  }
  return paths;
}

const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createRenderer(canvas, world, images, opts = {}) {
  const ctx = canvas.getContext('2d');
  const clocks = new Map(); // unité → { state, since }
  const floaters = [];
  const sparks = [];
  const fog = document.createElement('canvas');
  fog.width = Math.ceil(world.map.width / 4);
  fog.height = Math.ceil(world.map.height / 4);
  const fogCtx = fog.getContext('2d');
  let introBeat = null;
  let lastHitSound = -Infinity;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const visible = (u) => unitVisibleTo(world, u, localTeamOf());
  let debug = false;
  let cam = { x: world.map.width / 2, y: world.map.height / 2 };
  let lastView = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  const matchMode = !!world.match;

  const toasts = [];
  let hudHits = [];
  const toast = (text, ms = 3500) => toasts.push({ text, until: performance.now() + ms });
  const heroName = (id) => (getUnit(world, id) ? getUnit(world, id).def.name : '?');

  world.onEvent = (ev) => {
    if (ev.type === 'damage') {
      const t = getUnit(world, ev.targetId);
      if (t && visible(t)) {
        const text = ev.amount > 0 ? String(ev.amount) : ev.absorbed > 0 ? `🛡 ${ev.absorbed}` : '0';
        floaters.push({ x: t.x, y: t.y - (t.kind === 'hero' ? 130 : t.kind === 'monster' ? 110 : 90), text, age: 0, life: 900, color: '#ffe9a8' });
        if (!reducedMotion && ev.amount > 0) sparks.push({ x: t.x, y: t.y - 45, age: 0, life: 200, impact: true });
        if (ev.sourceId === localIdOf() && world.time - lastHitSound > 90) { play('hit'); lastHitSound = world.time; }
      }
    } else if (ev.type === 'move_order' && ev.heroId === localIdOf() && !reducedMotion) {
      sparks.push({ x: ev.x, y: ev.y, age: 0, life: 450, move: true });
    } else if (ev.type === 'gold' && ev.heroId === localIdOf()) {
      const hero = getUnit(world, ev.heroId);
      const x = ev.x ?? hero.x;
      const y = (ev.y ?? hero.y) - 115;
      const stack = floaters.filter((f) => f.gold && f.age < 450).length;
      floaters.push({ x, y: y - stack * 25, text: `+${ev.amount} or`, age: 0, life: 1200, color: COLORS.gold, gold: true });
      if (!reducedMotion) for (let i = 0; i < Math.min(7, 3 + Math.floor(ev.amount / 30)); i++) {
        sparks.push({ x, y: y + 35, age: 0, life: 850, coin: true, vx: Math.cos(i * 2.4) * 65, vy: -90 - i * 12, phase: i });
      }
    } else if (ev.type === 'boss_announce') toast(`Le Cerbère apparaît dans ${Math.round(ev.spawnInMs / 1000)} s`, 6000);
    else if (ev.type === 'boss_spawn') toast('Le Cerbère est apparu au centre', 4500);
    else if (ev.type === 'boss_killed') toast(ev.team ? `Cerbère vaincu par ${ev.team === localTeamOf() ? 'votre équipe' : "l'équipe adverse"}` : 'Cerbère vaincu', 4500);
    else if (ev.type === 'bonus_lane') toast(`Vague renforcée : ligne ${ev.lane === 'top' ? 'du haut' : 'du bas'}${ev.byDefault ? ' (choix par défaut)' : ''}`, 4500);
    else if (ev.type === 'tower_destroyed') toast(`Tour ${ev.tier === 'outer' ? 'extérieure' : 'intérieure'} détruite (${ev.team === localTeamOf() ? 'alliée' : 'adverse'})`, 3500);
    else if (ev.type === 'level_up' && ev.heroId === localIdOf()) {
      // L'ultime se débloque tout seul aux niveaux 3, 6 et 9 (aucun point à y mettre) ; on le dit.
      const ul = world.match ? world.match.progression.ultLevels : [];
      const hero = getUnit(world, ev.heroId);
      const parts = [`Niveau ${ev.level}`];
      if (ul.includes(ev.level)) parts.push(`ultime rang ${ul.indexOf(ev.level) + 1} débloqué`);
      if (hero && hero.points > 0) parts.push(`${hero.points} point${hero.points > 1 ? 's' : ''} à dépenser`);
      toast(parts.join(' · '), 4200);
    }
    else if (ev.type === 'death' && ev.heroId === localIdOf()) toast(`Éliminé${ev.killerId ? ' par ' + heroName(ev.killerId) : ''}`, 3500);
  };
  let localId_ = null;
  const localIdOf = () => localId_;
  const localTeamOf = () => (getUnit(world, localId_) ? getUnit(world, localId_).team : 'ally');

  function view(localId) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    let scale;
    if (matchMode) {
      scale = canvas.height / VIEW_H;
      const local = localId ? getUnit(world, localId) : null;
      if (local) cam = { x: local.x, y: local.y - 60 };
      const halfW = canvas.width / scale / 2;
      const halfH = canvas.height / scale / 2;
      cam.x = world.map.width <= halfW * 2 ? world.map.width / 2 : Math.min(world.map.width - halfW, Math.max(halfW, cam.x));
      cam.y = world.map.height <= halfH * 2 ? world.map.height / 2 : Math.min(world.map.height - halfH, Math.max(halfH, cam.y));
    } else {
      scale = Math.min(canvas.width / world.map.width, canvas.height / world.map.height);
      cam = { x: world.map.width / 2, y: world.map.height / 2 };
    }
    lastView = { scale, ox: canvas.width / 2 - cam.x * scale, oy: canvas.height / 2 - cam.y * scale, dpr };
    return lastView;
  }

  /** Coordonnées écran (CSS px) → coordonnées monde. */
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy, dpr } = lastView;
    return { x: ((clientX - rect.left) * dpr - ox) / scale, y: ((clientY - rect.top) * dpr - oy) / scale };
  }

  function animClock(unit, state) {
    let c = clocks.get(unit);
    if (!c || c.state !== state) {
      c = { state, since: world.time };
      clocks.set(unit, c);
    }
    return world.time - c.since;
  }

  function inCombat(hero) {
    if (hero.targetId === null) return false;
    const t = getUnit(world, hero.targetId);
    return !!t && !t.dead && edgeDistance(hero, t) <= hero.def.auto.range;
  }

  /* ------------------------------- terrain ------------------------------- */

  function drawGround() {
    const { width, height, obstacles } = world.map;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, width, height);
    // Décor déterministe : aucun aléatoire de simulation ni grille technique visible.
    for (let i = 0; i < 420; i++) {
      const x = (i * 173 + 31) % width;
      const y = (i * 251 + 67) % height;
      ctx.fillStyle = i % 3 ? '#79a58d10' : '#071f2928';
      ctx.beginPath();
      ctx.ellipse(x, y, 12 + i % 29, 5 + i % 13, i, 0, Math.PI * 2);
      ctx.fill();
    }

    if (world.map.lanes) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = COLORS.lane;
      ctx.lineWidth = 230;
      for (const L of Object.values(world.map.lanes)) {
        ctx.beginPath();
        L.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.strokeStyle = '#9cae8e28';
        ctx.lineWidth = 190;
        ctx.stroke();
        ctx.strokeStyle = '#233d3d88';
        ctx.lineWidth = 150;
        ctx.setLineDash([3, 46]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = COLORS.lane;
        ctx.lineWidth = 230;
      }
      ctx.restore();
      if (world.match) {
        for (const team of ['ally', 'enemy']) {
          const sp = world.map.spawns[team];
          ctx.save();
          ctx.fillStyle = team === 'ally' ? 'rgba(52,211,232,0.08)' : 'rgba(255,111,97,0.08)';
          ctx.strokeStyle = team === 'ally' ? 'rgba(52,211,232,0.4)' : 'rgba(255,111,97,0.4)';
          ctx.lineWidth = 4;
          ctx.setLineDash(world.time < world.match.spawnOpenMs ? [] : [14, 12]);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, world.match.spawnZoneRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.obstacleEdge;
    ctx.fillStyle = COLORS.obstacle;
    for (const o of obstacles) {
      ctx.beginPath();
      if (o.type === 'circle') {
        // Facettes inscrites dans l'obstacle : la silhouette reste fidèle à sa collision.
        for (let i = 0; i < 9; i++) {
          const a = i * Math.PI * 2 / 9;
          const x = o.x + Math.cos(a) * o.r;
          const y = o.y + Math.sin(a) * o.r;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
      }
      else ctx.rect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.save();
      ctx.shadowColor = '#03151b99';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 12;
      ctx.fill();
      ctx.restore();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#a1b79b20';
      ctx.beginPath();
      ctx.moveTo(o.x - 130, o.y - 120);
      ctx.lineTo(o.x + 130, o.y - 120);
      ctx.lineTo(o.x - 20, o.y + 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(0, 0, width, height);
  }

  function drawHeroOverlays(hero, local) {
    if (hero.dead) return;
    const target = hero.targetId !== null ? getUnit(world, hero.targetId) : null;
    if (local && target && !target.dead) {
      ctx.save();
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(target.x, target.y, target.radius + 14, (target.radius + 14) * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (debug) {
      // Portée = cercle réel (la simulation mesure des distances isotropes, bord à bord).
      ctx.save();
      ctx.strokeStyle = local ? 'rgba(255,211,107,0.45)' : 'rgba(255,255,255,0.2)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hero.x, hero.y, hero.radius + hero.def.auto.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (local && hero.moveTarget) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(hero.moveTarget.x, hero.moveTarget.y, 14, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ------------------------------- entités ------------------------------- */

  function teamColor(team, localTeam) {
    return team === localTeam ? COLORS.ally : COLORS.enemy;
  }

  function teamMark(x, y, team, localTeam, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (team === localTeam) ctx.arc(x, y, r, 0, Math.PI * 2); // disque = allié
    else {
      ctx.moveTo(x, y - r * 1.15); // triangle = adverse
      ctx.lineTo(x + r * 1.1, y + r * 0.9);
      ctx.lineTo(x - r * 1.1, y + r * 0.9);
      ctx.closePath();
    }
    ctx.fill();
  }

  const ultState = new Map(); // héros → { wasActive, endedAt } pour la pose de retour de l'ultime de Yeji

  function ultFlags(hero) {
    const abil = hero.def.sprites.abilities;
    if (!abil || !abil.ult || !abil.ult.holdFrames) return {};
    const active = world.zones.some((z) => z.ownerId === hero.id && z.kind === 'slow');
    const st = ultState.get(hero) || { wasActive: false, endedAt: -1e9 };
    if (st.wasActive && !active) st.endedAt = world.time;
    st.wasActive = active;
    ultState.set(hero, st);
    return { ultActive: active, recovering: !active && world.time - st.endedAt < abil.ult.recoveryMs };
  }

  function drawOrbit(hero, layer) {
    const fx = hero.def.sprites.abilities && hero.def.sprites.abilities.fx;
    const z = fx && fx.orbitRear ? world.zones.find((q) => q.ownerId === hero.id && q.kind === 'slow') : null;
    if (!z) return;
    const k = z.radius / fx.zoneHalfWidthPx;
    const e = world.time - z.startAt;
    const i = Math.floor(((e % fx.orbitPeriodMs) / fx.orbitPeriodMs) * fx.orbitFrames);
    const [cw, ch] = fx.orbitCell;
    const cols = fx.orbitGrid[0];
    const img = images[layer === 'rear' ? fx.orbitRear : fx.orbitFront];
    ctx.save();
    ctx.globalAlpha = Math.min(1, e / 200, (z.endAt - world.time) / 300);
    ctx.drawImage(img, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch, hero.x - fx.orbitAnchor[0] * k, hero.y - fx.orbitAnchor[1] * k, cw * k, ch * k);
    ctx.restore();
  }

  function drawShieldFx(hero) {
    const abil = hero.def.sprites.abilities;
    const fx = abil && abil.fx;
    if (!hero.shield || !fx || !fx.shield) return;
    const img = images[fx.shield];
    const s = hero.def.sprites.scale * abil.ult.scaleRelativeToCompanion;
    const t = world.time - hero.shield.since;
    const left = hero.shield.until - world.time;
    const pulse = 1 + 0.05 * Math.sin((t / fx.pulsePeriodMs) * Math.PI * 2);
    ctx.save();
    ctx.globalAlpha = 0.9 * Math.max(0, Math.min(1, t / fx.fadeInMs, left / fx.fadeOutMs));
    const w = img.width * s * pulse;
    const h = img.height * s * pulse;
    ctx.drawImage(img, hero.x - fx.shieldPivot[0] * s * pulse, hero.y - fx.shieldPivot[1] * s * pulse, w, h);
    ctx.restore();
  }

  function drawSlashFx(hero) {
    const abil = hero.def.sprites.abilities;
    const fx = abil && abil.fx;
    const c = hero.cast;
    if (!c || c.slot !== 'skill' || !fx || !fx.slash || c.ab.kind !== 'dash' || !c.ab.pass) return;
    const e = c.t - c.ab.strikeMs;
    if (e < 0 || e > 170) return;
    const img = images[fx.slash];
    const s = 0.55;
    ctx.save();
    ctx.globalAlpha = 1 - e / 170;
    ctx.translate(hero.x + c.dir.x * 60, hero.y - 70 + c.dir.y * 30);
    ctx.rotate(Math.atan2(c.dir.y, c.dir.x));
    ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
    ctx.restore();
  }

  /** Rappel : cercle au sol et jauge visibles de tous. */
  function drawRecall(hero) {
    const r = hero.recall;
    if (!r) return;
    const p = Math.min(1, r.t / r.durationMs);
    const rx = hero.radius * 2.7;
    const ry = rx * 0.5;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,211,107,0.35)';
    ctx.beginPath();
    ctx.ellipse(hero.x, hero.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,211,107,${0.06 + 0.05 * Math.sin(r.t / 120)})`;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = COLORS.gold;
    ctx.beginPath();
    ctx.ellipse(hero.x, hero.y, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    const w = 76;
    const y = hero.y + ry + 16;
    ctx.fillStyle = 'rgba(8,10,16,0.85)';
    ctx.fillRect(hero.x - w / 2 - 2, y - 2, w + 4, 12);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(hero.x - w / 2, y, w * p, 8);
    ctx.restore();
  }

  function drawHero(hero, localTeam) {
    if (hero.dead) return;
    drawRecall(hero);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(hero.x, hero.y, hero.radius * 1.1, hero.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Anneau d'équipe : distingue deux héros identiques des deux camps.
    ctx.strokeStyle = teamColor(hero.team, localTeam);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    const combat = inCombat(hero);
    const extra = ultFlags(hero);
    drawOrbit(hero, 'rear');
    const probe = pickSprite(hero, 0, combat, extra);
    const clock = animClock(hero, probe.kind);
    const s = pickSprite(hero, clock, combat, extra);
    ctx.save();
    ctx.translate(hero.x, hero.y);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(images[s.sheet], s.sx, s.sy, s.sw, s.sh, -s.anchor[0] * s.scale, -s.anchor[1] * s.scale, s.sw * s.scale, s.sh * s.scale);
    ctx.restore();
    drawOrbit(hero, 'front');
    drawShieldFx(hero);
    drawSlashFx(hero);
  }

  function drawStructure(u, localTeam) {
    const c = teamColor(u.team, localTeam);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 6, u.radius * 1.1, u.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    if (u.dead) {
      ctx.fillStyle = '#2a3140';
      ctx.beginPath();
      ctx.ellipse(u.x, u.y, u.radius * 0.9, u.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const vuln = isVulnerable(world, u);
    const h = u.kind === 'core' ? 150 : 120;
    ctx.fillStyle = '#242c3d';
    ctx.strokeStyle = vuln ? c : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(u.x - u.radius * 0.8, u.y);
    ctx.lineTo(u.x - u.radius * 0.5, u.y - h);
    ctx.lineTo(u.x + u.radius * 0.5, u.y - h);
    ctx.lineTo(u.x + u.radius * 0.8, u.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cristal : plein si vulnérable, creux sinon (invulnérable = contour seul).
    ctx.beginPath();
    ctx.moveTo(u.x, u.y - h - 46);
    ctx.lineTo(u.x + 26, u.y - h - 10);
    ctx.lineTo(u.x, u.y - h + 22);
    ctx.lineTo(u.x - 26, u.y - h - 10);
    ctx.closePath();
    if (vuln) {
      ctx.fillStyle = c;
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Sbires de ligne et monstres : planches de 6 images × 4 directions (cellules 384 × 288) ---
  const lastPos = new Map(); // unité → { x, y, at } pour savoir si elle marche
  const hashId = (id) => [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

  function isWalking(u) {
    const p = lastPos.get(u) || { x: u.x, y: u.y, at: -1e9 };
    if (Math.hypot(u.x - p.x, u.y - p.y) > 0.4) p.at = world.time;
    p.x = u.x;
    p.y = u.y;
    lastPos.set(u, p);
    return world.time - p.at < 160;
  }

  /** Haut du sprite (en unités monde au-dessus des pieds), pour placer barres et zone de clic. */
  function spriteHeight(u) {
    return u.def.sprite ? 232 * u.def.sprite.scale : u.radius * 2.6;
  }

  function drawFlames(u, fam, dirName) {
    const fx = fam.flames;
    const sp = u.def.special;
    if (!fx || !u.special || u.special.t < fx.startMs) return;
    const e = u.special.t - fx.startMs;
    const i = frameAt(fx.frameDurationsMs, e, false);
    if (e > fx.frameDurationsMs.reduce((a, b) => a + b, 0)) return;
    const L = world.match.sprites.layout;
    const k = u.def.sprite.scale;
    const [ex, ey] = fx.emit[dirName];
    const kf = sp.range / (fx.cell[0] - fx.anchor[0]); // l'effet est ajusté à la portée du cône
    ctx.save();
    ctx.translate(u.x + (ex - L.anchor[0]) * k, u.y + (ey - L.anchor[1]) * k);
    ctx.rotate(Math.atan2(u.special.dir.y, u.special.dir.x));
    ctx.globalAlpha = 0.95;
    const col = i % fx.grid[0];
    const row = Math.floor(i / fx.grid[0]);
    ctx.drawImage(images[fx.sheet], col * fx.cell[0], row * fx.cell[1], fx.cell[0], fx.cell[1], -fx.anchor[0] * kf, -fx.anchor[1] * kf, fx.cell[0] * kf, fx.cell[1] * kf);
    ctx.restore();
  }

  function drawCreature(u, localTeam) {
    const spr = u.def.sprite;
    const L = world.match.sprites.layout;
    const fam = world.match.sprites.families[spr.family];
    const k = spr.scale;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 2, u.radius * 1.05, u.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Anneau d'équipe sous les pieds ; violet pour les monstres neutres.
    ctx.strokeStyle = u.team === 'neutral' ? 'rgba(199,139,255,0.7)' : teamColor(u.team, localTeam);
    ctx.lineWidth = u.kind === 'minion' ? 3 : 4;
    ctx.stroke();
    ctx.restore();

    const dirName = directionFromFacing(u.facing);
    const row = L.directions[dirName];
    let sheet;
    let i;
    if (u.special && fam.breath) {
      sheet = fam.breath;
      i = frameAt(fam.breath.durationsMs, u.special.t, false);
    } else if (u.swing) {
      sheet = fam.attack;
      i = frameAt(fam.attack.durationsMs, u.swing.t, false);
    } else if (isWalking(u)) {
      sheet = fam.walk;
      i = frameAt(fam.walk.durationsMs, world.time + (hashId(u.id) % 600), true);
    } else {
      sheet = fam.attack; // à l'arrêt : première image d'attaque (pose de garde)
      i = 0;
    }
    if (dirName === 'back') drawFlames(u, fam, dirName);
    ctx.drawImage(images[sheet.sheet], i * L.cell[0], row * L.cell[1], L.cell[0], L.cell[1], u.x - L.anchor[0] * k, u.y - L.anchor[1] * k, L.cell[0] * k, L.cell[1] * k);
    if (dirName !== 'back') drawFlames(u, fam, dirName);
  }

  function zoneImageBack(z) {
    const owner = getUnit(world, z.ownerId);
    const fx = owner && owner.def.sprites.abilities && owner.def.sprites.abilities.fx;
    if (!fx) return;
    const e = world.time - z.startAt;
    const left = z.endAt - world.time;
    ctx.save();
    if (z.kind === 'slow' && fx.zone) {
      const k = z.radius / fx.zoneHalfWidthPx;
      const img = images[fx.zone];
      ctx.globalAlpha = 0.9 * Math.min(1, e / 250, left / 350);
      ctx.drawImage(img, z.x - 320 * k, z.y - 192 * k, 640 * k, 384 * k);
    } else if (z.kind === 'thorns' && fx.thornsBehind) {
      drawThorns(z, fx, images[fx.thornsBehind]);
    }
    ctx.restore();
  }

  function drawThorns(z, fx, img) {
    const e = world.time - z.startAt;
    const total = z.endAt - z.startAt;
    const [g0, g1] = fx.growthMs;
    const [w0, w1] = fx.withdrawalMs;
    let frame;
    if (e < g0) frame = 0;
    else if (e < g0 + g1) frame = 1;
    else if (e < total - (w0 + w1)) frame = 2;
    else if (e < total - w1) frame = 3;
    else frame = 0;
    const k = z.radius / fx.ringHalfWidthPx;
    const [cw, ch] = fx.cell;
    ctx.globalAlpha = world.time < z.armAt ? 0.65 : 1;
    ctx.drawImage(img, frame * cw, 0, cw, ch, z.x - fx.pivot[0] * k, z.y - fx.pivot[1] * k, cw * k, ch * k);
  }

  function zoneImageFront(z) {
    if (z.kind !== 'thorns') return;
    const owner = getUnit(world, z.ownerId);
    const fx = owner && owner.def.sprites.abilities && owner.def.sprites.abilities.fx;
    if (!fx || !fx.thornsFront) return;
    ctx.save();
    drawThorns(z, fx, images[fx.thornsFront]);
    ctx.restore();
  }

  function drawJungle() {
    if (!world.camps) return;
    ctx.save();
    ctx.textAlign = 'center';
    for (const c of world.camps) {
      ctx.strokeStyle = 'rgba(199,139,255,0.35)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 60, 34, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (c.respawnAt !== null && pointVisibleTo(world, localTeamOf(), c.x, c.y)) {
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(230,200,255,0.8)';
        ctx.font = '600 20px system-ui, sans-serif';
        ctx.fillText(`${Math.max(0, Math.ceil((c.respawnAt - world.time) / 1000))} s`, c.x, c.y + 7);
      }
    }
    // Fosse du boss, au centre exact de la carte.
    const { x, y } = world.match.boss;
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = 'rgba(255,179,71,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, 130, 74, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (world.boss.unitId === null) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,200,120,0.9)';
      ctx.font = '700 26px system-ui, sans-serif';
      ctx.fillText(`Boss ${fmtClock(Math.max(0, world.boss.spawnAt - world.time))}`, x, y + 9);
    }
    ctx.restore();
  }

  function drawAim(hero, aim) {
    if (!aim || hero.dead || hero.cast) return;
    const ab = hero.def.abilities && hero.def.abilities[aim.slot];
    if (!ab || hero.rank[aim.slot] < 1) return;
    const rank = hero.rank[aim.slot];
    ctx.save();
    ctx.fillStyle = 'rgba(255,211,107,0.16)';
    ctx.strokeStyle = 'rgba(255,211,107,0.8)';
    ctx.lineWidth = 3;
    const t = hero.targetId !== null ? getUnit(world, hero.targetId) : null;
    let ax = aim.x;
    let ay = aim.y;
    let range = ab.range[Math.min(rank, ab.range.length) - 1];
    if (ab.kind === 'dash' && t && !t.dead && edgeDistance(hero, t) <= range) {
      ax = t.x;
      ay = t.y;
      range = Math.min(range, Math.hypot(t.x - hero.x, t.y - hero.y) + (ab.endsPast || 0));
    }
    const len = Math.hypot(ax - hero.x, ay - hero.y) || 1;
    const dx = (ax - hero.x) / len;
    const dy = (ay - hero.y) / len;
    if (ab.kind === 'dash') {
      const w = (ab.hitRadius || 40) * 2;
      ctx.translate(hero.x, hero.y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillRect(0, -w / 2, range, w);
      ctx.strokeRect(0, -w / 2, range, w);
    } else if (ab.kind === 'fan') {
      for (const deg of ab.anglesDeg) {
        const a = Math.atan2(dy, dx) + (deg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(hero.x, hero.y);
        ctx.lineTo(hero.x + Math.cos(a) * range, hero.y + Math.sin(a) * range);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawBar(x, y, w, h, ratio, color, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.85)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, ratio), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    if (label) {
      ctx.fillStyle = COLORS.ink;
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, y - 8);
    }
    ctx.restore();
  }

  function drawBars(u, localTeam) {
    if (u.dead) return;
    const c = teamColor(u.team, localTeam);
    const ratio = u.hp / u.maxHp;
    if (u.kind === 'hero') {
      drawBar(u.x - 48, u.y - 168, 96, 11, ratio, c, `${u.def.name}  ${Math.ceil(u.hp)}/${u.maxHp}`);
      ctx.save();
      teamMark(u.x - 64, u.y - 162, u.team, localTeam, 6, c);
      ctx.restore();
    } else if (u.kind === 'minion') {
      if (ratio < 1) drawBar(u.x - 22, u.y - spriteHeight(u) - 6, 44, 6, ratio, c);
    } else if (u.kind === 'monster') {
      if (u.boss) drawBar(u.x - 70, u.y - spriteHeight(u) - 14, 140, 12, ratio, '#ffb347', `${u.def.name}  ${Math.ceil(u.hp)}/${u.maxHp}`);
      else if (ratio < 1) drawBar(u.x - 26, u.y - spriteHeight(u) - 6, 52, 7, ratio, '#c78bff');
    } else {
      const top = u.y - (u.kind === 'core' ? 215 : 185);
      drawBar(u.x - 55, top, 110, 10, ratio, c, vulnLabel(u));
    }
  }

  function vulnLabel(u) {
    const base = u.def.name;
    return isVulnerable(world, u) ? `${base}  ${Math.ceil(u.hp)}` : `${base} · protégé`;
  }

  function drawProjectile(p, localTeam) {
    const owner = getUnit(world, p.ownerId);
    const proj = owner && owner.kind === 'hero' ? owner.def.sprites.attack.projectile : null;
    ctx.save();
    if (proj) {
      const atk = owner.def.sprites.attack;
      const s = owner.def.sprites.scale * atk.scaleRelativeToCompanion * proj.scaleRelativeToAtlas;
      const img = images[proj.texture];
      ctx.translate(p.x, p.y - 80);
      ctx.rotate(Math.atan2(p.dir.y, p.dir.x));
      ctx.drawImage(img, -proj.pivot[0] * s, -proj.pivot[1] * s, img.width * s, img.height * s);
    } else {
      const lift = p.ownerKind === 'tower' ? 110 : 40;
      ctx.translate(p.x, p.y - lift);
      ctx.fillStyle = teamColor(p.team, localTeam);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.ownerKind === 'tower' ? 9 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFloaters(dtMs) {
    for (const f of floaters) f.age += dtMs;
    ctx.save();
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, Math.max(0, (f.life - f.age) / 350));
      ctx.fillStyle = f.color;
      ctx.font = `${f.gold ? 800 : 700} ${f.gold ? 26 : 22}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 4;
      const y = f.y - (reducedMotion ? 0 : f.age * 0.05);
      ctx.strokeText(f.text, f.x, y);
      ctx.fillText(f.text, f.x, y);
    }
    ctx.restore();
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].age > floaters[i].life) floaters.splice(i, 1);
  }

  /* --------------------------------- HUD --------------------------------- */

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(7,24,33,0.92)';
    ctx.strokeStyle = 'rgba(180,206,186,0.35)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  function drawHud(localId) {
    const local = getUnit(world, localId);
    const localTeam = local ? local.team : 'ally';
    const foe = localTeam === 'ally' ? 'enemy' : 'ally';
    const u = lastView.dpr * Math.max(0.65, Math.min(1.3, canvas.clientHeight / 900)); // échelle d'interface
    hudHits = [];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Haut centre : chrono, éliminations, tours détruites.
    const cx = canvas.width / 2;
    panel(cx - 170 * u, 8 * u, 340 * u, 46 * u);
    pushHit(cx - 170 * u, 0, 340 * u, Math.max(54 * u, 44 * lastView.dpr), { type: 'scores' }); // toucher le score ouvre le tableau (cible tactile d'au moins 44 px)
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${22 * u}px system-ui, sans-serif`;
    ctx.fillText(fmtClock(world.time), cx, 40 * u);
    ctx.font = `600 ${15 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.ally;
    ctx.fillText(`● ${world.stats[localTeam].kills} él.  ${world.stats[localTeam].towers} tours`, cx - 50 * u, 38 * u);
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.enemy;
    ctx.fillText(`▲ ${world.stats[foe].kills} él.  ${world.stats[foe].towers} tours`, cx + 50 * u, 38 * u);

    // Bas : PV du joueur, ou compte à rebours de réapparition.
    if (local) {
      if (opts.touch) {
        // Dimensions en pixels CSS : texte et jauge ont chacun leur ligne, quel que soit le DPR.
        const px = lastView.dpr;
        const bw = 200 * px;
        const bx = cx - bw / 2;
        const top = canvas.height - 74 * px;
        panel(bx, top, bw, 64 * px);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = `600 ${12 * px}px system-ui, sans-serif`;
        ctx.fillStyle = COLORS.ink;
        ctx.fillText(`${local.def.name} · Niv ${local.level || 1}`, cx, top + 8 * px);
        ctx.fillText(`${Math.ceil(local.hp)} / ${local.maxHp}`, cx, top + 27 * px);
        ctx.fillStyle = '#10151f';
        ctx.fillRect(bx + 10 * px, top + 48 * px, bw - 20 * px, 8 * px);
        ctx.fillStyle = COLORS.ally;
        ctx.fillRect(bx + 10 * px, top + 48 * px, (bw - 20 * px) * Math.max(0, Math.min(1, local.hp / local.maxHp)), 8 * px);
        ctx.textBaseline = 'alphabetic';
      } else {
        const bw = 360 * u;
        const bx = cx - bw / 2;
        const by = canvas.height - 46 * u;
        panel(bx - 10 * u, by - 14 * u, bw + 20 * u, 42 * u);
        ctx.fillStyle = '#10151f';
        ctx.fillRect(bx, by, bw, 14 * u);
        ctx.fillStyle = COLORS.ally;
        ctx.fillRect(bx, by, bw * (local.hp / local.maxHp), 14 * u);
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.ink;
        ctx.font = `600 ${Math.max(12 * lastView.dpr, 14 * u)}px system-ui, sans-serif`;
        ctx.fillText(`${local.def.name} · Niv ${local.level || 1}  ${Math.ceil(local.hp)} / ${local.maxHp}   ·   ${local.kills} / ${local.deaths} / ${local.assists}`, cx, by + 14 * u);
      }
      if (local.dead && local.respawnAt !== null) {
        ctx.font = `700 ${34 * u}px system-ui, sans-serif`;
        ctx.fillStyle = COLORS.ink;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 6;
        const txt = `Réapparition dans ${Math.ceil((local.respawnAt - world.time) / 1000)} s`;
        ctx.strokeText(txt, cx, canvas.height * 0.42);
        ctx.fillText(txt, cx, canvas.height * 0.42);
      }
    }
    if (world.match && world.time < world.match.spawnOpenMs + 1800) {
      const left = Math.ceil((world.match.spawnOpenMs - world.time) / 1000);
      const beat = Math.max(0, left);
      if (introBeat !== beat) { play(beat === 0 ? 'start' : 'tick'); introBeat = beat; }
      ctx.textAlign = 'center';
      ctx.font = `800 ${32 * u}px system-ui, sans-serif`;
      ctx.fillStyle = COLORS.gold;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 5;
      const txt = left > 0 ? `Préparez-vous · ${left}` : 'En avant !';
      ctx.strokeText(txt, cx, canvas.height * 0.3);
      ctx.fillText(txt, cx, canvas.height * 0.3);
      ctx.font = `600 ${16 * u}px system-ui, sans-serif`;
      const tip = left > 0 ? 'Choisissez votre objet de départ dans la boutique' : 'Avancez avec vos sbires pour gagner la vision';
      ctx.strokeText(tip, cx, canvas.height * 0.3 + 30 * u);
      ctx.fillText(tip, cx, canvas.height * 0.3 + 30 * u);
    }
    if (world.match) drawMinimap(localTeam, u);
    if (world.match) {
      drawBossLine(u);
      drawAbilityBar(local, u);
      drawBonusPrompt(local, u);
    }
    drawToasts(u);
    ctx.restore();
  }

  function pushHit(x, y, w, h, action) {
    hudHits.push({ x, y, w, h, action });
  }

  function wrapText(text, x, y, lineH, maxLines) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (ctx.measureText(cur ? `${cur} ${w}` : w).width > 58 * (canvas.height / 900) && cur) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push(cur);
    lines.slice(0, maxLines).forEach((l, i, a) => ctx.fillText(l, x, y + (i - (a.length - 1) / 2) * lineH));
  }

  function drawAbilityBar(local, u) {
    if (opts.touch) return; // sur mobile, les boutons d'action sont en HTML (voir src/ui/touch.js)
    if (!local || !world.match || !local.def.abilities) return;
    const ab = local.def.abilities;
    const levels = world.match.progression.levels;
    const cx = canvas.width / 2;
    const size = 66 * u;
    const gap = 12 * u;
    const total = 3 * size + 2 * gap;
    const x0 = cx - total / 2;
    const y0 = canvas.height - 150 * u;

    // Niveau, XP et points à dépenser.
    const by = y0 - 34 * u;
    panel(x0 - 6 * u, by - 6 * u, total + 12 * u, 28 * u);
    const prevT = levels[local.level - 1];
    const nextT = local.level < levels.length ? levels[local.level] : null;
    ctx.fillStyle = '#10151f';
    ctx.fillRect(x0, by + 12 * u, total, 6 * u);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(x0, by + 12 * u, nextT ? (total * (local.xp - prevT)) / (nextT - prevT) : total, 6 * u);
    ctx.font = `700 ${13 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(`Niv ${local.level}`, x0, by + 8 * u);
    ctx.textAlign = 'right';
    ctx.fillStyle = local.points > 0 ? COLORS.gold : 'rgba(244,241,232,0.7)';
    ctx.fillText(local.points > 0 ? `${local.points} point${local.points > 1 ? 's' : ''} à dépenser` : nextT ? `XP ${local.xp} / ${nextT}` : 'Niveau max', x0 + total, by + 8 * u);

    const slots = [
      { id: 'auto', key: 'clic', name: 'Attaque', rank: local.rank.auto, ready: true, total: 0, needs: null },
      { id: 'skill', key: 'Q', name: ab.skill.name, rank: local.rank.skill, total: ab.skill.cooldownMs[Math.max(0, local.rank.skill - 1)], needs: 'Niv 2' },
      { id: 'ult', key: 'R', name: ab.ult.name, rank: local.rank.ult, total: ab.ult.cooldownMs[Math.max(0, local.rank.ult - 1)], needs: 'Niv 3' },
    ];
    slots.forEach((sl, i) => {
      const x = x0 + i * (size + gap);
      const left = sl.id === 'auto' ? 0 : cooldownLeft(world, local, sl.id);
      const usable = sl.rank > 0 && left === 0 && !local.cast && !local.dead;
      ctx.fillStyle = sl.rank > 0 ? 'rgba(14,18,28,0.9)' : 'rgba(14,18,28,0.55)';
      ctx.fillRect(x, y0, size, size);
      ctx.strokeStyle = usable && sl.id !== 'auto' ? COLORS.gold : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = usable && sl.id !== 'auto' ? 3 : 1;
      ctx.strokeRect(x + 0.5, y0 + 0.5, size, size);
      ctx.fillStyle = sl.rank > 0 ? COLORS.ink : 'rgba(244,241,232,0.45)';
      ctx.textAlign = 'center';
      ctx.font = `600 ${12 * u}px system-ui, sans-serif`;
      if (!(left > 0 && sl.rank > 0)) wrapText(sl.name, x + size / 2, y0 + size / 2 - 2 * u, 14 * u, 3);
      ctx.textAlign = 'left';
      ctx.font = `700 ${11 * u}px system-ui, sans-serif`;
      ctx.fillStyle = COLORS.gold;
      ctx.fillText(sl.key, x + 5 * u, y0 + 13 * u);
      // Rang : trois repères.
      for (let r = 0; r < 3; r++) {
        ctx.fillStyle = r < sl.rank ? COLORS.gold : 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + size / 2 - 17 * u + r * 12 * u, y0 + size - 9 * u, 9 * u, 4 * u);
      }
      if (sl.rank === 0) {
        ctx.fillStyle = 'rgba(244,241,232,0.65)';
        ctx.textAlign = 'center';
        ctx.font = `600 ${11 * u}px system-ui, sans-serif`;
        ctx.fillText(sl.needs, x + size / 2, y0 + size - 14 * u);
      }
      if (left > 0 && sl.rank > 0) {
        ctx.fillStyle = 'rgba(5,7,12,0.7)';
        ctx.fillRect(x, y0, size, size * Math.min(1, left / sl.total));
        ctx.fillStyle = COLORS.ink;
        ctx.textAlign = 'center';
        ctx.font = `700 ${22 * u}px system-ui, sans-serif`;
        ctx.fillText(String(Math.ceil(left / 1000)), x + size / 2, y0 + size / 2 + 8 * u);
      }
      // Bouton « + » : un point à dépenser (auto et skill, jusqu'au rang 3).
      if (sl.id !== 'ult' && local.points > 0 && sl.rank < 3) {
        const bx = x + size - 6 * u;
        const byy = y0 - 4 * u;
        ctx.fillStyle = COLORS.gold;
        ctx.beginPath();
        ctx.arc(bx, byy, 13 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b2230';
        ctx.textAlign = 'center';
        ctx.font = `800 ${20 * u}px system-ui, sans-serif`;
        ctx.fillText('+', bx, byy + 7 * u);
        pushHit(bx - 17 * u, byy - 17 * u, 34 * u, 34 * u, { type: 'level_up', slot: sl.id });
      }
      if (sl.id !== 'auto') pushHit(x, y0, size, size, { type: 'cast-slot', slot: sl.id });
    });
  }

  function drawBonusPrompt(local, u) {
    const ch = world.bonus && local ? world.bonus.choices.find((c) => c.chooserId === local.id && !c.lane) : null;
    if (!ch) return;
    const cx = canvas.width / 2;
    const w = 380 * u;
    const y = 112 * u;
    panel(cx - w / 2, y, w, 86 * u);
    ctx.fillStyle = COLORS.gold;
    ctx.textAlign = 'center';
    ctx.font = `700 ${16 * u}px system-ui, sans-serif`;
    ctx.fillText(`Vague renforcée : choisissez une ligne (${Math.max(0, Math.ceil((ch.expiresAt - world.time) / 1000))} s)`, cx, y + 24 * u);
    [['top', 'Haut'], ['bottom', 'Bas']].forEach(([lane, label], i) => {
      const bx = cx - 150 * u + i * 160 * u;
      ctx.fillStyle = 'rgba(255,211,107,0.18)';
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = 2;
      ctx.fillRect(bx, y + 38 * u, 140 * u, 36 * u);
      ctx.strokeRect(bx, y + 38 * u, 140 * u, 36 * u);
      ctx.fillStyle = COLORS.ink;
      ctx.font = `700 ${17 * u}px system-ui, sans-serif`;
      ctx.fillText(`${label}  (${i + 1})`, bx + 70 * u, y + 62 * u);
      pushHit(bx, y + 38 * u, 140 * u, 36 * u, { type: 'bonus', lane });
    });
  }

  function drawToasts(u) {
    const now = performance.now();
    for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i].until < now) toasts.splice(i, 1);
    // Coin haut droit : n'empiète ni sur le héros ni sur l'invite de choix de ligne.
    const rx = canvas.width - 14 * u;
    ctx.textAlign = 'right';
    ctx.font = `600 ${15 * u}px system-ui, sans-serif`;
    toasts.slice(-5).forEach((t, i) => {
      const w = ctx.measureText(t.text).width + 28 * u;
      const y = Math.max(14 * u, 64 * lastView.dpr) + i * 32 * u; // sous les boutons HTML du haut
      ctx.fillStyle = 'rgba(14,18,28,0.85)';
      ctx.fillRect(rx - w, y, w, 26 * u);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(t.text, rx - 14 * u, y + 18 * u);
    });
  }

  function drawBossLine(u) {
    if (!world.boss) return;
    const cx = canvas.width / 2;
    ctx.textAlign = 'center';
    ctx.font = `600 ${13 * u}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffb347';
    const limit = world.match.timeLimitMs ? ` · fin à ${fmtClock(world.match.timeLimitMs)}` : '';
    ctx.fillText((world.boss.unitId ? 'Boss en jeu' : `Boss dans ${fmtClock(Math.max(0, world.boss.spawnAt - world.time))}`) + limit, cx, 70 * u);
  }

  function drawMinimap(localTeam, u) {
    const mw = (opts.touch ? 190 : 220) * u;
    const mh = (mw * world.map.height) / world.map.width;
    const x0 = 10 * u;
    const y0 = 10 * u;
    const sx = mw / world.map.width;
    panel(x0 - 4, y0 - 4, mw + 8, mh + 8);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.fillStyle = '#102d33';
    ctx.fillRect(0, 0, mw, mh);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(140,160,195,0.35)';
    ctx.lineWidth = 9 * u * 0.6;
    for (const L of Object.values(world.map.lanes)) {
      ctx.beginPath();
      L.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * sx, y * sx) : ctx.moveTo(x * sx, y * sx)));
      ctx.stroke();
    }
    ctx.drawImage(fog, 0, 0, mw, mh);
    const seen = (e) => unitVisibleTo(world, e, localTeam);
    for (const e of world.units) {
      if (e.dead || !seen(e)) continue;
      const c = teamColor(e.team, localTeam);
      ctx.fillStyle = c;
      if (e.kind === 'minion') {
        ctx.fillRect(e.x * sx - 1.5, e.y * sx - 1.5, 3, 3);
      } else if (e.kind === 'hero') {
        ctx.beginPath();
        ctx.arc(e.x * sx, e.y * sx, 5 * u * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const s = (e.kind === 'core' ? 10 : 7) * u * 0.7;
        ctx.fillRect(e.x * sx - s / 2, e.y * sx - s / 2, s, s);
      }
    }
    // Cadre de la vue actuelle.
    const vw = (canvas.width / lastView.scale) * sx;
    const vh = (canvas.height / lastView.scale) * sx;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cam.x * sx - vw / 2, cam.y * sx - vh / 2, vw, vh);
    ctx.restore();
  }

  function drawDebug(localId) {
    const lines = [];
    for (const h of world.heroes) {
      const t = h.targetId !== null ? getUnit(world, h.targetId) : null;
      lines.push(
        `${h.def.name}${h.id === localId ? ' (vous)' : ''}${h.team === 'enemy' ? ' ▲' : ''} · hp ${Math.ceil(h.hp)}${h.dead ? ' †' : ''}` +
          ` · cible ${t ? t.def.name : '—'}` +
          (t ? ` · bord-à-bord ${Math.round(edgeDistance(h, t))} / portée ${h.def.auto.range}` : '') +
          ` · ${h.dead ? 'mort' : h.moveTarget || h.steer ? 'déplacement' : h.swing ? 'attaque ' + Math.round(h.swing.t) + ' ms' : 'immobile'}`,
      );
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const top = matchMode ? Math.round(canvas.height * 0.2) : 10;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(10, top, 780, 22 * lines.length + 14);
    ctx.fillStyle = '#d9e2f2';
    ctx.font = '14px ui-monospace, monospace';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, 20, top + 22 + i * 22));
    ctx.restore();
  }

  // Un seul masque pour le terrain et la mini-carte ; bord doux à l'intérieur de la portée réelle.
  function updateFog(team) {
    if (!matchMode) return;
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.clearRect(0, 0, fog.width, fog.height);
    fogCtx.fillStyle = 'rgba(3,8,18,0.86)';
    fogCtx.fillRect(0, 0, fog.width, fog.height);
    fogCtx.globalCompositeOperation = 'destination-out';
    for (const source of visionSources(world, team)) {
      const x = source.x / 4, y = source.y / 4, r = VISION_RADII[source.kind] / 4;
      const gradient = fogCtx.createRadialGradient(x, y, r * 0.8, x, y, r);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      fogCtx.fillStyle = gradient;
      fogCtx.beginPath();
      fogCtx.arc(x, y, r, 0, Math.PI * 2);
      fogCtx.fill();
    }
    fogCtx.globalCompositeOperation = 'source-over';
  }

  function drawSparks(dtMs) {
    ctx.save();
    for (const p of sparks) {
      p.age += dtMs;
      const t = p.age / 1000;
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.strokeStyle = p.coin ? '#fff0b0' : '#fff';
      ctx.fillStyle = COLORS.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (p.coin) {
        const x = p.x + p.vx * t, y = p.y + p.vy * t + 95 * t * t;
        ctx.ellipse(x, y, Math.max(1.5, Math.abs(Math.cos(t * 16 + p.phase)) * 6), 8, -0.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.move) {
        ctx.strokeStyle = COLORS.ally;
        ctx.ellipse(p.x, p.y, 12 + p.age * 0.04, 6 + p.age * 0.02, 0, 0, Math.PI * 2);
      } else {
        const r = 8 + p.age * 0.12;
        ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
      }
      ctx.stroke();
    }
    ctx.restore();
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].age >= sparks[i].life) sparks.splice(i, 1);
  }

  /* -------------------------------- dessin -------------------------------- */

  function draw(dtMs, localId, aim) {
    localId_ = localId;
    const { scale, ox, oy } = view(localId);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, world.map.width, world.map.height);
    ctx.clip();
    updateFog(localTeamOf());
    drawGround();
    if (world.match) drawJungle();
    if (matchMode) ctx.drawImage(fog, 0, 0, world.map.width, world.map.height);
    for (const z of world.zones) if (z.team === localTeamOf() || pointVisibleTo(world, localTeamOf(), z.x, z.y)) zoneImageBack(z);

    const local = getUnit(world, localId);
    const localTeam = local ? local.team : 'ally';
    drawAim(local, aim);
    for (const h of world.heroes) if (visible(h)) drawHeroOverlays(h, h.id === localId);
    const sorted = [...world.units].sort((a, b) => a.y - b.y);
    for (const e of sorted) {
      if (!visible(e)) continue;
      if (e.kind === 'hero') drawHero(e, localTeam);
      else if (e.kind === 'minion' || e.kind === 'monster') drawCreature(e, localTeam);
      else drawStructure(e, localTeam);
    }
    for (const z of world.zones) if (z.team === localTeam || pointVisibleTo(world, localTeam, z.x, z.y)) zoneImageFront(z);
    for (const p of world.projectiles) if (pointVisibleTo(world, localTeam, p.x, p.y)) drawProjectile(p, localTeam);
    for (const e of world.units) if (visible(e)) drawBars(e, localTeam);
    drawSparks(dtMs);
    drawFloaters(dtMs);
    ctx.restore();
    drawHud(localId);
    if (debug) drawDebug(localId);
  }

  function hitHud(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * lastView.dpr;
    const y = (clientY - rect.top) * lastView.dpr;
    for (const h of hudHits) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.action;
    return null;
  }

  return {
    draw,
    toWorld,
    hitHud,
    setDebug: (v) => (debug = v),
    toggleDebug: () => (debug = !debug),
    isDebug: () => debug,
  };
}
