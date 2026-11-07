// Rendu canvas : lit l'état de simulation, ne le modifie jamais.
// Les sbires, tours et noyaux sont dessinés de façon procédurale (aucun sprite fourni pour l'instant).
import { edgeDistance, getUnit, isVulnerable } from '../sim/world.js';
import { pickSprite } from './animator.js';

const COLORS = {
  ally: '#34d3e8',
  enemy: '#ff6f61',
  ground: '#1b2230',
  grid: 'rgba(255,255,255,0.04)',
  lane: 'rgba(120,140,175,0.13)',
  obstacle: '#3a4458',
  obstacleEdge: '#566178',
  ink: '#f4f1e8',
  gold: '#ffd36b',
};
const VIEW_H = 900; // hauteur visible en unités monde (mode match)
const VISION = 900; // un ennemi n'apparaît sur la minimap que s'il est vu par un allié

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
          img.src = src;
        }),
    ),
  ).then(() => out);
}

export function collectImagePaths(heroDefs) {
  const paths = [];
  for (const d of Object.values(heroDefs)) {
    paths.push(d.sprites.companion.sheet, d.sprites.attack.sheet);
    if (d.sprites.attack.projectile) paths.push(d.sprites.attack.projectile.texture);
  }
  return paths;
}

const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createRenderer(canvas, world, images) {
  const ctx = canvas.getContext('2d');
  const clocks = new Map(); // unité → { state, since }
  const floaters = [];
  let debug = false;
  let cam = { x: world.map.width / 2, y: world.map.height / 2 };
  let lastView = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  const matchMode = !!world.match;

  world.onEvent = (ev) => {
    if (ev.type === 'damage') {
      const t = getUnit(world, ev.targetId);
      if (t && t.kind !== 'minion') floaters.push({ x: t.x, y: t.y - (t.kind === 'hero' ? 130 : 90), text: String(ev.amount), age: 0 });
    }
  };

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
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

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
      if (o.type === 'circle') ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      else ctx.rect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.fill();
      ctx.stroke();
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

  function drawHero(hero, localTeam) {
    if (hero.dead) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(hero.x, hero.y, hero.radius * 1.1, hero.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Anneau d'équipe : distingue deux héros identiques des deux camps.
    ctx.strokeStyle = teamColor(hero.team, localTeam);
    ctx.lineWidth = 4;
    ctx.stroke();
    const combat = inCombat(hero);
    const probe = pickSprite(hero, 0, combat);
    const clock = animClock(hero, probe.kind);
    const s = pickSprite(hero, clock, combat);
    ctx.translate(hero.x, hero.y);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(images[s.sheet], s.sx, s.sy, s.sw, s.sh, -s.anchor[0] * s.scale, -s.anchor[1] * s.scale, s.sw * s.scale, s.sh * s.scale);
    ctx.restore();
  }

  function drawMinion(u, localTeam) {
    const c = teamColor(u.team, localTeam);
    const ranged = u.minionType === 'ranged';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 4, u.radius, u.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Corps : cercle (mêlée) ou losange (distance), ton d'équipe ; symbole d'équipe au centre.
    ctx.fillStyle = '#10151f';
    ctx.strokeStyle = c;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (ranged) {
      ctx.moveTo(u.x, u.y - u.radius * 1.6);
      ctx.lineTo(u.x + u.radius, u.y - u.radius * 0.5);
      ctx.lineTo(u.x, u.y + u.radius * 0.5);
      ctx.lineTo(u.x - u.radius, u.y - u.radius * 0.5);
      ctx.closePath();
    } else ctx.arc(u.x, u.y - u.radius * 0.6, u.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    teamMark(u.x, u.y - u.radius * 0.6, u.team, localTeam, 5, c);
    ctx.restore();
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
      if (ratio < 1) drawBar(u.x - 22, u.y - u.radius * 2.6 - 6, 44, 6, ratio, c);
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
      ctx.globalAlpha = Math.max(0, 1 - f.age / 900);
      ctx.fillStyle = '#ffe9a8';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 4;
      const y = f.y - f.age * 0.05;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillText(f.text, f.x, y);
    }
    ctx.restore();
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].age > 900) floaters.splice(i, 1);
  }

  /* --------------------------------- HUD --------------------------------- */

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(14,18,28,0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  function drawHud(localId) {
    const local = getUnit(world, localId);
    const localTeam = local ? local.team : 'ally';
    const foe = localTeam === 'ally' ? 'enemy' : 'ally';
    const u = Math.max(1, canvas.height / 900); // échelle d'interface
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Haut centre : chrono, éliminations, tours détruites.
    const cx = canvas.width / 2;
    panel(cx - 170 * u, 8 * u, 340 * u, 46 * u);
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
      ctx.font = `600 ${14 * u}px system-ui, sans-serif`;
      ctx.fillText(`${local.def.name}  ${Math.ceil(local.hp)} / ${local.maxHp}   ·   ${local.kills} / ${local.deaths} / ${local.assists}`, cx, by - 20 * u + 34 * u);
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
    if (world.match && world.time < world.match.spawnOpenMs) {
      ctx.textAlign = 'center';
      ctx.font = `700 ${26 * u}px system-ui, sans-serif`;
      ctx.fillStyle = COLORS.gold;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 5;
      const txt = `Sortie dans ${Math.ceil((world.match.spawnOpenMs - world.time) / 1000)} s`;
      ctx.strokeText(txt, cx, canvas.height * 0.3);
      ctx.fillText(txt, cx, canvas.height * 0.3);
    }
    if (world.match) drawMinimap(localTeam, u);
    ctx.restore();
  }

  function drawMinimap(localTeam, u) {
    const mw = 260 * u;
    const mh = (mw * world.map.height) / world.map.width;
    const x0 = 10 * u;
    const y0 = 10 * u;
    const sx = mw / world.map.width;
    panel(x0 - 4, y0 - 4, mw + 8, mh + 8);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.fillStyle = '#141a27';
    ctx.fillRect(0, 0, mw, mh);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(140,160,195,0.35)';
    ctx.lineWidth = 9 * u * 0.6;
    for (const L of Object.values(world.map.lanes)) {
      ctx.beginPath();
      L.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * sx, y * sx) : ctx.moveTo(x * sx, y * sx)));
      ctx.stroke();
    }
    const seen = (e) => e.team === localTeam || world.units.some((a) => !a.dead && a.team === localTeam && Math.hypot(a.x - e.x, a.y - e.y) < VISION);
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
          ` · ${h.dead ? 'mort' : h.moveTarget ? 'déplacement' : h.swing ? 'attaque ' + Math.round(h.swing.t) + ' ms' : 'immobile'}`,
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

  /* -------------------------------- dessin -------------------------------- */

  function draw(dtMs, localId) {
    const { scale, ox, oy } = view(localId);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, world.map.width, world.map.height);
    ctx.clip();
    drawGround();

    const local = getUnit(world, localId);
    const localTeam = local ? local.team : 'ally';
    for (const h of world.heroes) drawHeroOverlays(h, h.id === localId);
    const sorted = [...world.units].sort((a, b) => a.y - b.y);
    for (const e of sorted) {
      if (e.kind === 'hero') drawHero(e, localTeam);
      else if (e.kind === 'minion') drawMinion(e, localTeam);
      else drawStructure(e, localTeam);
    }
    for (const p of world.projectiles) drawProjectile(p, localTeam);
    for (const e of world.units) drawBars(e, localTeam);
    drawFloaters(dtMs);
    ctx.restore();
    drawHud(localId);
    if (debug) drawDebug(localId);
  }

  return {
    draw,
    toWorld,
    setDebug: (v) => (debug = v),
    toggleDebug: () => (debug = !debug),
    isDebug: () => debug,
  };
}
