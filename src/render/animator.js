// Choix de l'image à dessiner. Pur : aucune dépendance au canvas, donc testable.

export function frameAt(durationsMs, tMs, loop) {
  const total = durationsMs.reduce((a, b) => a + b, 0);
  let t = loop ? ((tMs % total) + total) % total : Math.min(Math.max(tMs, 0), total - 1);
  for (let i = 0; i < durationsMs.length; i++) {
    if (t < durationsMs[i]) return i;
    t -= durationsMs[i];
  }
  return durationsMs.length - 1;
}

/** Direction du corps pour les planches d'attaque à quatre orientations. */
export function directionFromFacing(f) {
  if (Math.abs(f.x) >= Math.abs(f.y)) return f.x >= 0 ? 'right' : 'left';
  return f.y >= 0 ? 'front' : 'back';
}

/**
 * Retourne {kind, sheet, sx, sy, sw, sh, anchor, scale, flip} pour un héros.
 * animClockMs : temps écoulé dans l'état courant (boucle pour idle/course).
 * inCombat : cible verrouillée et à portée (déclenche la garde entre deux coups).
 */
export function pickSprite(hero, animClockMs, inCombat = false) {
  const sp = hero.def.sprites;
  const comp = sp.companion;
  const atk = sp.attack;
  const baseScale = sp.scale;

  // Attaque en cours : planche d'attaque, jouée une seule fois.
  if (hero.swing) {
    const durations = hero.def.auto.frameDurationsMs;
    const i = frameAt(durations, hero.swing.t, false);
    const [cw, ch] = atk.cell;
    const scale = baseScale * atk.scaleRelativeToCompanion;
    if (atk.directions) {
      const dir = directionFromFacing(hero.facing);
      return { kind: 'attack', sheet: atk.sheet, sx: i * cw, sy: atk.directions[dir] * ch, sw: cw, sh: ch, anchor: atk.anchor, scale, flip: false, frame: i };
    }
    // Planche unique tournée vers la droite : miroir pour viser à gauche.
    const flip = atk.mirrorLeft && hero.facing.x < 0;
    return { kind: 'attack', sheet: atk.sheet, sx: i * cw, sy: 0, sw: cw, sh: ch, anchor: atk.anchor, scale, flip, frame: i };
  }

  // Garde : verrou en place, à portée, entre deux coups (si une planche à quatre directions existe).
  const [cw, ch] = comp.cell;
  if (!hero.moveTarget && inCombat && atk.directions) {
    const [acw, ach] = atk.cell;
    const dir = directionFromFacing(hero.facing);
    return { kind: 'guard', sheet: atk.sheet, sx: 5 * acw, sy: atk.directions[dir] * ach, sw: acw, sh: ach, anchor: atk.anchor, scale: baseScale * atk.scaleRelativeToCompanion, flip: false, frame: 5 };
  }

  const state = hero.moveTarget ? (hero.facing.x >= 0 ? 'running-right' : 'running-left') : 'idle';
  const anim = comp.animations[state];
  const i = frameAt(anim.durationsMs, animClockMs, true);
  return { kind: state, sheet: comp.sheet, sx: i * cw, sy: anim.row * ch, sw: cw, sh: ch, anchor: comp.anchor, scale: baseScale, flip: false, frame: i };
}
