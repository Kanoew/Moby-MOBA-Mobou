// Effets de présentation : événements réels d'impact, aucune écriture dans la simulation.
import { VISION_RADII, unitVisibleTo } from '../sim/vision.js';

export const FX_LIMITS = { full: { bursts: 32, numbers: 40 }, light: { bursts: 8, numbers: 20 } };
const SOLID = [], ENEMY_DASH = [14, 10], ARM_DASH = [5, 9];
const INK = { physical: '#ffe1a0', magic: '#e7a5ff', incoming: '#ff887d', shield: '#85deff', kill: '#ffd36b' };
const boundedPush = (list, value, max) => { if (list.length >= max) list.shift(); list.push(value); };

// Une catégorie visuelle, pas une nouvelle règle de dégâts ou de résistance.
export const impactStyle = (source) => source?.key === 'jennie' || source?.special ? 'magic' : 'physical';

// Seulement les segments où le dash avance, jamais sa préparation ni sa récupération.
export function dashFeedbackActive(hero) {
  const c = hero.cast;
  if (c?.ab.kind !== 'dash' || c.stopped) return false;
  const curve = c.ab.movementCurve;
  for (let i = 1; i < curve.length; i++) {
    if (c.t >= curve[i - 1][0] && c.t < curve[i][0]) return curve[i][1] > curve[i - 1][1];
  }
  return false;
}

export function createCombatEffects(world, { localId = 'player', onSound = () => {}, mode = 'full' } = {}) {
  let setting = mode === 'light' ? 'light' : 'full', age = 0;
  const bursts = [], numbers = [], flashes = new Map(), contacts = new Map();
  let banner = null, shakeAt = -Infinity, soundAt = -Infinity;
  const local = () => world.byId.get(localId);
  const team = () => local()?.team ?? 'ally';
  const seen = (u) => !!u && unitVisibleTo(world, u, team());
  // Références aux sources, valables pour une image ; aucune position interpolée mémorisée.
  const sources = [];
  const zoneLabels = new WeakMap();
  let prepared = false, renderTeam = team();
  function pointVisibleAtDraw(x, y) {
    if (!world.match || renderTeam === 'neutral') return true;
    if (!prepared) {
      sources.length = 0;
      for (const u of world.units) if (!u.dead && u.team === renderTeam && VISION_RADII[u.kind]) sources.push(u);
      prepared = true;
    }
    for (const u of sources) if ((u.x - x) ** 2 + (u.y - y) ** 2 <= VISION_RADII[u.kind] ** 2) return true;
    return false;
  }
  const visibleAtDraw = (u) => !!u && (u.team === renderTeam || (!u.invisible && pointVisibleAtDraw(u.x, u.y)));
  const limits = () => FX_LIMITS[setting];
  const burst = (u, kind, color, life = 330) => boundedPush(bursts, { unitId: u.id, x: u.x, y: u.y - 50, kind, color, born: age, life }, limits().bursts);
  const sound = (name) => { if (age - soundAt >= 75) { onSound(name); soundAt = age; } };
  const shake = () => { if (setting === 'full' && age - shakeAt > 200) shakeAt = age; };

  function onEvent(ev) {
    prepared = false;
    const source = world.byId.get(ev.sourceId ?? ev.heroId);
    const target = world.byId.get(ev.targetId);
    if (ev.type === 'hit' || ev.type === 'ability_hit') {
      // L'événement précède immédiatement damage ; un seul contexte, même pour un projectile après la fin du lancer.
      contacts.set(`${ev.heroId}:${ev.targetId}`, { at: ev.t, projectile: ev.projectileId != null, slot: ev.slot ?? (ev.skill ? 'skill' : 'auto') });
      if (contacts.size > 64) contacts.delete(contacts.keys().next().value);
    } else if (ev.type === 'damage' && seen(target)) {
      const key = `${ev.sourceId}:${ev.targetId}`;
      const contact = contacts.get(key); contacts.delete(key);
      const zoneBurst = seen(source) && world.zones.some((z) => z.ownerId === source.id && z.kind === 'thorns' && world.time >= z.armAt && world.time - z.armAt < 32 && Math.hypot(target.x - z.x, target.y - z.y) <= z.radius);
      const slot = contact?.at === ev.t ? contact.slot : zoneBurst ? 'ult' : null;
      const incoming = target.id === localId;
      const mine = source?.id === localId;
      const style = impactStyle(seen(source) ? source : null);
      const color = ev.amount <= 0 ? INK.shield : incoming ? INK.incoming : INK[style];
      const important = ev.amount > 0 && (slot === 'skill' || slot === 'ult' || ev.amount >= target.maxHp * 0.15);
      if (target.kind !== 'minion' || mine || incoming || setting === 'full') {
        let existing = null, lane = 0;
        for (let i = numbers.length - 1; i >= 0; i--) {
          const n = numbers[i];
          if (n.unitId !== target.id) continue;
          if (age - n.born < 450) lane++;
          if (!existing && n.absorbed === (ev.amount <= 0) && age - n.born < 90) existing = n;
        }
        if (existing) { existing.amount += ev.amount || ev.absorbed || 0; existing.important ||= important; }
        else boundedPush(numbers, { unitId: target.id, x: target.x, footY: target.y, y: target.y - (target.kind === 'hero' ? 155 : 100), born: age, life: 850,
          amount: ev.amount || ev.absorbed || 0, absorbed: ev.amount <= 0, color, important,
          lane: lane % 3 }, limits().numbers);
      }
      if (ev.amount > 0) {
        flashes.set(target.id, age);
        if (flashes.size > 64) flashes.delete(flashes.keys().next().value);
        burst(target, slot === 'ult' ? 'ultimate' : contact?.projectile ? 'projectile' : style, color, important ? 400 : 260);
        if (mine || incoming) {
          sound(style === 'magic' ? 'hit_magic' : source?.key === 'sweetie' ? 'hit_heavy' : 'hit_blade');
          if ((slot === 'ult' || ev.amount >= target.maxHp * 0.25) && target.kind === 'hero') shake();
        }
      }
    } else if (ev.type === 'cast_start' && seen(source)) {
      burst(source, ev.slot === 'ult' ? 'ultimate' : 'cast', impactStyle(source) === 'magic' ? INK.magic : '#63e6e7', ev.slot === 'ult' ? 600 : 220);
      if (source.id === localId) sound(ev.slot === 'ult' ? 'ult_cast' : source.key === 'jennie' ? 'skill_magic' : 'skill_dash');
    } else if ((ev.type === 'zone_start' || ev.type === 'shield_on') && seen(source)) {
      burst(source, 'ultimate', source.key === 'sweetie' ? INK.shield : source.key === 'jennie' ? INK.magic : '#63e6e7', 650);
    } else if (ev.type === 'death') {
      const victim = world.byId.get(ev.heroId), killer = world.byId.get(ev.killerId);
      if (seen(victim)) burst(victim, 'death', victim.id === localId ? INK.incoming : INK.kill, 750);
      if (ev.killerId === localId || ev.heroId === localId) {
        banner = { text: ev.heroId === localId ? 'Vous avez été éliminé' : 'Élimination', color: ev.heroId === localId ? INK.incoming : INK.kill, born: age, life: 1600 };
        onSound(ev.heroId === localId ? 'defeat_hit' : 'kill');
        if (victim?.id === localId || (killer?.id === localId && seen(victim))) shake();
      }
    }
  }

  function configure(next) {
    const value = next === 'light' ? 'light' : 'full';
    if (setting === value) return;
    setting = value; shakeAt = -Infinity; flashes.clear();
    bursts.length = 0;
    if (numbers.length > limits().numbers) numbers.splice(0, numbers.length - limits().numbers);
  }

  function expire(list) { for (let i = list.length - 1; i >= 0; i--) if (age - list[i].born >= list[i].life) list.splice(i, 1); }

  function advance(dt, perspectiveTeam = team()) {
    renderTeam = perspectiveTeam; prepared = false;
    age += Number.isFinite(dt) ? Math.max(0, Math.min(100, dt)) : 0;
    expire(bursts); expire(numbers);
    for (const [id, born] of flashes) if (age - born >= 100) flashes.delete(id);
    for (const [key, value] of contacts) if (world.time - value.at > 32) contacts.delete(key);
    if (banner && age - banner.born >= banner.life) banner = null;
  }

  function draw(ctx) {
    ctx.save();
    for (const p of bursts) {
      if (!visibleAtDraw(world.byId.get(p.unitId)) || !pointVisibleAtDraw(p.x, p.y + 50)) continue;
      const t = (age - p.born) / p.life;
      ctx.globalAlpha = (1 - t) * (setting === 'light' ? 0.6 : 0.9);
      ctx.strokeStyle = p.color; ctx.fillStyle = p.color; ctx.lineWidth = p.kind === 'death' ? 3 : 2;
      const r = (p.kind === 'ultimate' ? 55 : p.kind === 'death' ? 35 : 12) + (setting === 'full' ? t * (p.kind === 'ultimate' ? 35 : 20) : 0);
      ctx.beginPath();
      if (p.kind === 'physical') {
        ctx.moveTo(p.x - r, p.y + r * 0.5); ctx.lineTo(p.x + r, p.y - r * 0.5);
        if (setting === 'full') { ctx.moveTo(p.x - r * 0.5, p.y - r * 0.7); ctx.lineTo(p.x + r * 0.5, p.y + r * 0.7); }
      } else if (p.kind === 'projectile') {
        ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
      } else {
        ctx.ellipse(p.x, p.y + 32, r, r * 0.45, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      if (setting === 'full' && p.kind !== 'cast') {
        const count = p.kind === 'death' || p.kind === 'ultimate' ? 6 : 3;
        for (let i = 0; i < count; i++) {
          const a = i * Math.PI * 2 / count + (p.kind === 'magic' ? t : 0);
          const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r * 0.7 - t * 15;
          ctx.beginPath();
          if (p.kind === 'magic') { ctx.ellipse(x, y, 3, 7, a, 0, Math.PI * 2); ctx.fill(); }
          else { ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 6); ctx.stroke(); }
        }
      }
    }
    ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#08121ee8';
    for (const n of numbers) {
      if (!visibleAtDraw(world.byId.get(n.unitId)) || !pointVisibleAtDraw(n.x, n.footY)) continue;
      const t = (age - n.born) / n.life;
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      ctx.fillStyle = n.color;
      const pop = setting === 'full' ? 1 + 0.18 * Math.max(0, 1 - t * 6) : 1;
      ctx.font = `800 ${Math.round((n.important ? 29 : n.absorbed ? 18 : 22) * pop)}px system-ui, sans-serif`;
      const x = n.x + (n.lane - 1) * 17, y = n.y - n.lane * 16 - (setting === 'full' ? t * 45 : 0);
      const text = n.absorbed ? `Absorbé ${n.amount}` : String(n.amount);
      ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  // Lu uniquement pendant le dessin : aucune position interpolée n'est conservée dans ce module.
  function drawActor(ctx, hero) {
    if (setting !== 'full' || hero.dead || !visibleAtDraw(hero)) return;
    const c = hero.cast, swing = hero.swing;
    ctx.save();
    ctx.strokeStyle = hero.key === 'sweetie' ? INK.physical : hero.key === 'jennie' ? INK.magic : '#75f4ed';
    if (dashFeedbackActive(hero)) {
      const dx = hero.x - c.start.x, dy = hero.y - c.start.y, distance = Math.hypot(dx, dy);
      if (distance > 1) {
        const k = Math.min(1, 110 / distance);
        if (!pointVisibleAtDraw(hero.x - dx * k, hero.y - dy * k)) { ctx.restore(); return; }
        ctx.globalAlpha = 0.4; ctx.lineWidth = hero.key === 'sweetie' ? 16 : 8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hero.x - dx * k, hero.y - 40 - dy * k); ctx.lineTo(hero.x, hero.y - 40); ctx.stroke();
      }
    }
    if (swing && hero.def.auto.kind === 'melee') {
      const time = swing.t - hero.timing.hitMs;
      if (time >= -50 && time < 130) {
        ctx.globalAlpha = Math.sin((time + 50) / 180 * Math.PI) * 0.65; ctx.lineWidth = hero.key === 'sweetie' ? 8 : 4;
        ctx.beginPath(); ctx.ellipse(hero.x, hero.y - 55, 76, 44, 0, Math.atan2(hero.facing.y, hero.facing.x) - 1, Math.atan2(hero.facing.y, hero.facing.x) + 1); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawZone(ctx, z) {
    if (z.team !== renderTeam && !pointVisibleAtDraw(z.x, z.y)) return;
    const remaining = z.endAt - world.time;
    if (remaining <= 0) return;
    const arming = world.time < z.armAt, allied = z.team === renderTeam;
    const tenth = Math.ceil((arming ? z.armAt - world.time : remaining) / 100);
    let label = zoneLabels.get(z);
    if (!label || label.tenth !== tenth || label.arming !== arming) {
      label = { tenth, arming, text: `${arming ? '! ' : ''}${(tenth / 10).toFixed(1)} s` };
      zoneLabels.set(z, label);
    }
    ctx.save(); ctx.strokeStyle = allied ? '#75f4ed' : '#ff887d'; ctx.lineWidth = arming ? 3 : 4;
    ctx.globalAlpha = arming ? 0.9 : 0.72;
    ctx.setLineDash(allied ? SOLID : arming ? ARM_DASH : ENEMY_DASH);
    // Le disque de simulation est circulaire dans x/y, même si la texture est en perspective.
    ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash(SOLID);
    if (setting === 'full') {
      const fraction = Math.max(0, Math.min(1, remaining / Math.max(1, z.endAt - z.startAt)));
      ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, Math.max(0, z.radius - 6), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.font = '700 24px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = '#08121e'; ctx.fillStyle = allied ? '#bafff7' : '#ffd4cc';
    ctx.strokeText(label.text, z.x, z.y + z.radius + 26); ctx.fillText(label.text, z.x, z.y + z.radius + 26);
    ctx.restore();
  }

  function drawProjectile(ctx, p, lift) {
    if (!pointVisibleAtDraw(p.x, p.y)) return;
    const x = p.x, y = p.y - lift, tail = p.skill ? 65 : 40;
    ctx.save(); ctx.strokeStyle = p.team === renderTeam ? '#75f4ed' : '#ff887d';
    ctx.lineCap = 'round'; ctx.lineWidth = p.skill ? 7 : 5; ctx.globalAlpha = 0.65;
    if (setting === 'full' && pointVisibleAtDraw(x - p.dir.x * tail, p.y - p.dir.y * tail)) {
      ctx.beginPath(); ctx.moveTo(x - p.dir.x * tail, y - p.dir.y * tail); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.globalAlpha = 0.85; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, p.skill ? 13 : 10, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  function drawEcho(ctx, hero, sprite, img) {
    if (setting !== 'full' || !dashFeedbackActive(hero)) return;
    const dx = hero.x - hero.cast.start.x, dy = hero.y - hero.cast.start.y, d = Math.hypot(dx, dy);
    if (d < 1) return;
    const k = Math.min(1, 32 / d), x = hero.x - dx * k, y = hero.y - dy * k;
    if (!pointVisibleAtDraw(x, y)) return;
    ctx.save(); ctx.globalAlpha = 0.16; ctx.translate(x, y);
    if (sprite.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -sprite.anchor[0] * sprite.scale, -sprite.anchor[1] * sprite.scale, sprite.sw * sprite.scale, sprite.sh * sprite.scale);
    ctx.restore();
  }

  return { onEvent, configure, advance, draw, drawActor, drawProjectile, drawEcho, drawZone, visibleAtDraw, pointVisibleAtDraw,
    flashAlpha: (id) => setting === 'full' && flashes.has(id) ? Math.max(0, 0.4 * (1 - (age - flashes.get(id)) / 80)) : 0,
    shake: () => {
      const t = age - shakeAt;
      if (setting !== 'full' || t < 0 || t > 160) return { x: 0, y: 0 };
      const strength = 2.5 * (1 - t / 160);
      return { x: Math.sin(t * 0.13) * strength, y: Math.cos(t * 0.17) * strength * 0.6 };
    },
    banner: () => banner ? { ...banner, alpha: Math.min(1, (banner.life - age + banner.born) / 250) } : null,
    stats: () => ({ mode: setting, bursts: bursts.length, numbers: numbers.length, flashes: flashes.size, contacts: contacts.size }),
  };
}
