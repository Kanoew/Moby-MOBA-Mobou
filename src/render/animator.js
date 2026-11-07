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
 * extra : { ultActive, recovering } pour la pose de maintien de l'ultime de Yeji.
 */
export function pickSprite(hero, animClockMs, inCombat = false, extra = {}) {
  const sp = hero.def.sprites;
  const comp = sp.companion;
  const atk = sp.attack;
  const baseScale = sp.scale;

  // Lancer de compétence ou d'ultime : planche dédiée, jouée une fois.
  if (hero.cast && sp.abilities && sp.abilities[hero.cast.slot]) {
    const a = sp.abilities[hero.cast.slot];
    const i = frameAt(a.frameDurationsMs, hero.cast.t, false);
    const [cw, ch] = a.cell;
    const scale = baseScale * a.scaleRelativeToCompanion;
    if (a.directions) {
      const dir = directionFromFacing(hero.facing);
      return { kind: `cast-${hero.cast.slot}`, sheet: a.sheet, sx: i * cw, sy: a.directions[dir] * ch, sw: cw, sh: ch, anchor: a.anchor, scale, flip: false, frame: i };
    }
    const flip = a.mirrorLeft && hero.facing.x < 0;
    return { kind: `cast-${hero.cast.slot}`, sheet: a.sheet, sx: i * cw, sy: 0, sw: cw, sh: ch, anchor: a.anchor, scale, flip, frame: i };
  }

  // Rappel : danse sur place, séquence de poses propre à chaque héros, jouée une fois.
  if (hero.recall && sp.recall) {
    const rc = sp.recall;
    const seq = rc.sequence;
    let t = Math.min(hero.recall.t, seq.reduce((a, f) => a + f.durationMs, 0) - 1);
    let k = 0;
    while (k < seq.length - 1 && t >= seq[k].durationMs) t -= seq[k++].durationMs;
    const frame = seq[k].frame;
    const [cw, ch] = rc.cell;
    const scale = baseScale * rc.scaleRelativeToCompanion;
    if (rc.directions) {
      const dir = directionFromFacing(hero.recall.facing);
      return { kind: 'recall', sheet: rc.sheet, sx: frame * cw, sy: rc.directions[dir] * ch, sw: cw, sh: ch, anchor: rc.anchor, scale, flip: false, frame };
    }
    const flip = rc.mirrorLeft && hero.recall.facing.x < 0;
    return { kind: 'recall', sheet: rc.sheet, sx: frame * cw, sy: 0, sw: cw, sh: ch, anchor: rc.anchor, scale, flip, frame };
  }

  // Maintien de l'ultime (Yeji) : deux poses alternées tant que la zone dure, puis pose de retour.
  const ult = sp.abilities && sp.abilities.ult;
  if (ult && ult.holdFrames && !(hero.moveTarget || hero.steer || hero.walking) && !hero.swing && (extra.ultActive || extra.recovering)) {
    const [cw, ch] = ult.cell;
    const dir = directionFromFacing(hero.facing);
    const frame = extra.ultActive ? ult.holdFrames[Math.floor(animClockMs / ult.holdFrameMs) % ult.holdFrames.length] : ult.recoveryFrame;
    return { kind: extra.ultActive ? 'ult-hold' : 'ult-recover', sheet: ult.sheet, sx: frame * cw, sy: ult.directions[dir] * ch, sw: cw, sh: ch, anchor: ult.anchor, scale: baseScale * ult.scaleRelativeToCompanion, flip: false, frame };
  }

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
  if (!(hero.moveTarget || hero.steer || hero.walking) && inCombat && atk.directions) {
    const [acw, ach] = atk.cell;
    const dir = directionFromFacing(hero.facing);
    return { kind: 'guard', sheet: atk.sheet, sx: 5 * acw, sy: atk.directions[dir] * ach, sw: acw, sh: ach, anchor: atk.anchor, scale: baseScale * atk.scaleRelativeToCompanion, flip: false, frame: 5 };
  }

  const state = hero.moveTarget || hero.steer || hero.walking ? (hero.facing.x >= 0 ? 'running-right' : 'running-left') : 'idle';
  const anim = comp.animations[state];
  const i = frameAt(anim.durationsMs, animClockMs, true);
  return { kind: state, sheet: comp.sheet, sx: i * cw, sy: anim.row * ch, sw: cw, sh: ch, anchor: comp.anchor, scale: baseScale, flip: false, frame: i };
}
