// Rendu canvas : lit l'état de simulation, ne le modifie jamais.
import { edgeDistance, getHero } from '../sim/world.js';
import { pickSprite } from './animator.js';

const COLORS = {
  ally: '#34d3e8',
  enemy: '#ff6f61',
  ground: '#1b2230',
  grid: 'rgba(255,255,255,0.045)',
  obstacle: '#3a4458',
  obstacleEdge: '#566178',
};

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

export function createRenderer(canvas, world, images) {
  const ctx = canvas.getContext('2d');
  const clocks = new Map(); // héros → { state, since }
  const floaters = [];
  let debug = false;

  world.onEvent = (ev) => {
    if (ev.type === 'damage') {
      const t = getHero(world, ev.targetId);
      if (t) floaters.push({ x: t.x, y: t.y - 130, text: String(ev.amount), age: 0, team: t.team });
    }
  };

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const scale = Math.min(canvas.width / world.map.width, canvas.height / world.map.height);
    const ox = (canvas.width - world.map.width * scale) / 2;
    const oy = (canvas.height - world.map.height * scale) / 2;
    return { scale, ox, oy, dpr };
  }

  /** Coordonnées écran (CSS px) → coordonnées monde. */
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy, dpr } = fit();
    return {
      x: ((clientX - rect.left) * dpr - ox) / scale,
      y: ((clientY - rect.top) * dpr - oy) / scale,
    };
  }

  function animClock(hero, state) {
    let c = clocks.get(hero);
    if (!c || c.state !== state) {
      c = { state, since: world.time };
      clocks.set(hero, c);
    }
    return world.time - c.since;
  }

  function inCombat(hero) {
    if (hero.targetId === null) return false;
    const t = getHero(world, hero.targetId);
    return !!t && !t.dead && edgeDistance(hero, t) <= hero.def.auto.range;
  }

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

  function drawHeroRings(hero, local) {
    // Marqueur de cible : anneau + losange pour ne pas dépendre de la couleur seule.
    const target = hero.targetId !== null ? getHero(world, hero.targetId) : null;
    if (local && target && !target.dead) {
      ctx.save();
      ctx.strokeStyle = '#ffd36b';
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

  function drawHero(hero) {
    ctx.save();
    // Ombre
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(hero.x, hero.y, hero.radius * 1.1, hero.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const combat = inCombat(hero);
    const probe = pickSprite(hero, 0, combat);
    const clock = animClock(hero, probe.kind);
    const s = pickSprite(hero, clock, combat);
    const img = images[s.sheet];
    ctx.translate(hero.x, hero.y);
    if (s.flip) ctx.scale(-1, 1);
    ctx.globalAlpha = hero.dead ? 0.35 : 1;
    ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, -s.anchor[0] * s.scale, -s.anchor[1] * s.scale, s.sw * s.scale, s.sh * s.scale);
    ctx.restore();
  }

  function drawHealthBar(hero, localTeam) {
    const w = 96;
    const h = 11;
    const x = hero.x - w / 2;
    const y = hero.y - 168;
    const color = hero.team === localTeam ? COLORS.ally : COLORS.enemy;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.85)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, (w * hero.hp) / hero.maxHp, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    // Symbole d'équipe : disque (allié) ou triangle (adverse), lisible sans la couleur.
    const sx = x - 16;
    const sy = y + h / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (hero.team === localTeam) ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    else {
      ctx.moveTo(sx, sy - 7);
      ctx.lineTo(sx + 7, sy + 6);
      ctx.lineTo(sx - 7, sy + 6);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = '#f4f1e8';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${hero.def.name}  ${hero.hp}/${hero.maxHp}`, hero.x, y - 8);
    ctx.restore();
  }

  function drawProjectile(p) {
    const owner = getHero(world, p.ownerId);
    const atk = owner.def.sprites.attack;
    const proj = atk.projectile;
    const img = images[proj.texture];
    const s = owner.def.sprites.scale * atk.scaleRelativeToCompanion * proj.scaleRelativeToAtlas;
    ctx.save();
    ctx.translate(p.x, p.y - 80); // départ à hauteur de main
    ctx.rotate(Math.atan2(p.dir.y, p.dir.x));
    ctx.drawImage(img, -proj.pivot[0] * s, -proj.pivot[1] * s, img.width * s, img.height * s);
    ctx.restore();
  }

  function drawFloaters(dtMs) {
    for (const f of floaters) f.age += dtMs;
    ctx.save();
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of floaters) {
      const a = Math.max(0, 1 - f.age / 900);
      ctx.globalAlpha = a;
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

  function drawDebug(localId) {
    const lines = [];
    for (const h of world.heroes) {
      const t = h.targetId !== null ? getHero(world, h.targetId) : null;
      lines.push(
        `${h.def.name}${h.id === localId ? ' (vous)' : ''} · hp ${h.hp}` +
          ` · cible ${t ? t.def.name : '—'}` +
          (t ? ` · bord-à-bord ${Math.round(edgeDistance(h, t))} / portée ${h.def.auto.range}` : '') +
          ` · ${h.moveTarget ? 'déplacement' : h.swing ? 'attaque ' + Math.round(h.swing.t) + ' ms' : 'immobile'}`,
      );
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(10, 10, 760, 22 * lines.length + 14);
    ctx.fillStyle = '#d9e2f2';
    ctx.font = '14px ui-monospace, monospace';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, 20, 32 + i * 22));
    ctx.restore();
  }

  function draw(dtMs, localId) {
    const { scale, ox, oy } = fit();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, world.map.width, world.map.height);
    ctx.clip();
    drawGround();

    const local = getHero(world, localId);
    const localTeam = local ? local.team : 'ally';
    for (const h of world.heroes) drawHeroRings(h, h.id === localId);
    const sorted = [...world.heroes].sort((a, b) => a.y - b.y);
    for (const h of sorted) drawHero(h);
    for (const p of world.projectiles) drawProjectile(p);
    for (const h of world.heroes) if (!h.dead) drawHealthBar(h, localTeam);
    drawFloaters(dtMs);
    ctx.restore();
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
