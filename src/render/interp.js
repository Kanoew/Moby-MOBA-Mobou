// Interpolation visuelle des positions entre deux pas de simulation.
// La simulation avance par pas fixes (16 ms) ; l'écran se rafraîchit à son propre rythme (60, 90, 120, 144 Hz).
// Sans interpolation, la position ne change qu'à chaque pas : à 120 Hz une image sur deux est identique, à 60 Hz un pas
// double arrive de temps en temps. Ici, on mémorise la position avant chaque pas et on dessine entre l'ancienne et la nouvelle.
//
//  - `snapshot(world)` est appelé juste avant chaque `step()`. Il ne touche pas aux champs de la simulation (x, y, hp…) :
//    il ajoute seulement `px`/`py` (position précédente) sur les unités et les projectiles.
//  - `applyInterpolation(world, alpha)` place temporairement chaque position au point interpolé et renvoie la fonction qui
//    remet les positions réelles. À utiliser autour du dessin uniquement : la simulation ne voit jamais les valeurs lissées.
//  - Un saut plus grand que `maxJump` (réapparition, rappel, téléportation) n'est pas lissé : sinon on verrait un glissement.

export const INTERP = { maxJump: 160 };

export function snapshot(world) {
  for (const u of world.units) {
    u.px = u.x;
    u.py = u.y;
  }
  for (const p of world.projectiles) {
    p.px = p.x;
    p.py = p.y;
  }
}

/** Fraction du pas écoulée, bornée à [0, 1]. */
export const alphaOf = (accMs, stepMs) => (stepMs > 0 && Number.isFinite(accMs) ? Math.min(1, Math.max(0, accMs / stepMs)) : 1);

export function applyInterpolation(world, alpha, maxJump = INTERP.maxJump) {
  const touched = [];
  if (!(alpha < 1) || !(alpha >= 0)) return () => {};
  const lerp = (o) => {
    if (!Number.isFinite(o.px) || !Number.isFinite(o.py)) return;
    const dx = o.x - o.px;
    const dy = o.y - o.py;
    if (dx === 0 && dy === 0) return;
    if (dx * dx + dy * dy > maxJump * maxJump) return;
    touched.push(o, o.x, o.y);
    o.x = o.px + dx * alpha;
    o.y = o.py + dy * alpha;
  };
  for (const u of world.units) lerp(u);
  for (const p of world.projectiles) lerp(p);
  return () => {
    for (let i = 0; i < touched.length; i += 3) {
      touched[i].x = touched[i + 1];
      touched[i].y = touched[i + 2];
    }
  };
}
