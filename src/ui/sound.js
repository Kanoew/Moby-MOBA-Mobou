// Retours sonores courts (WebAudio, aucun fichier). Créé au premier appui de l'utilisateur, coupable.
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem('moba.mute') === '1' || new URLSearchParams(location.search).get('mute') === '1';
} catch {
  /* stockage indisponible */
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem('moba.mute', m ? '1' : '0');
  } catch {
    /* sans effet */
  }
}

/** À appeler dans un geste utilisateur (les navigateurs refusent de produire du son avant). */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  if (typeof AudioContext === 'undefined') return;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
}

function tone(freq, start, dur, type = 'sine', gain = 0.06) {
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  gold: () => { tone(1320, 0, 0.06, 'triangle', 0.035); tone(1760, 0.045, 0.13, 'sine', 0.025); },
  tick: () => tone(440, 0, 0.06, 'sine', 0.025),
  start: () => { tone(523, 0, 0.12); tone(659, 0.1, 0.12); tone(1046, 0.2, 0.3); },
  hit_blade: () => { tone(620, 0, 0.035, 'triangle', 0.025); tone(180, 0.025, 0.07, 'sawtooth', 0.014); },
  hit_heavy: () => { tone(95, 0, 0.11, 'triangle', 0.045); tone(190, 0.02, 0.06, 'triangle', 0.025); },
  hit_magic: () => { tone(880, 0, 0.07, 'sine', 0.03); tone(1320, 0.04, 0.11, 'sine', 0.02); },
  ult_cast: () => { tone(196, 0, 0.12, 'triangle', 0.04); tone(392, 0.08, 0.18, 'sine', 0.025); },
  kill: () => { tone(784, 0, 0.1); tone(988, 0.09, 0.12); tone(1568, 0.18, 0.2, 'sine', 0.035); },
  defeat_hit: () => { tone(220, 0, 0.13, 'triangle', 0.03); tone(147, 0.1, 0.2, 'triangle', 0.025); },
  buy: () => { tone(660, 0, 0.09); tone(990, 0.08, 0.14); },
  sell: () => { tone(880, 0, 0.08, 'triangle'); tone(587, 0.07, 0.12, 'triangle'); },
  deny: () => tone(150, 0, 0.16, 'square', 0.04),
  recall: () => { tone(523, 0, 0.12); tone(659, 0.1, 0.12); tone(784, 0.2, 0.2); },
  cancel: () => tone(220, 0, 0.12, 'sawtooth', 0.035),
  level: () => { tone(740, 0, 0.1); tone(988, 0.09, 0.18); },
};

export function play(name) {
  if (muted || !ctx || !SOUNDS[name]) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    SOUNDS[name]();
  } catch {
    /* le son est un confort, jamais une erreur */
  }
}
