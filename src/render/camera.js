// Caméra hybride : suit le héros avec un lissage, peut être déplacée temporairement, puis revient.
// Module pur (aucun DOM, aucune horloge) : le rendu lui donne le temps réel écoulé et l'état du héros.
//
//  - Suivi : lissage exponentiel. Plus rapide pendant un dash ou quand l'écart devient grand ; saut direct après une
//    téléportation (réapparition, rappel).
//  - Exploration : `pan()` ajoute un décalage (en unités monde) pendant le glissé. Au relâchement, le décalage reste
//    `returnDelayMs`, puis fond progressivement. Le mode « libre » (`toggleHold`) le garde jusqu'au recentrage.
//  - Visée : léger décalage vers le point visé d'une compétence.
//  - La caméra reste dans les limites de la carte. Elle ne modifie jamais la simulation ni la visibilité des unités.

export const CAMERA = {
  followMs: 70, // constante de temps du suivi normal
  fastMs: 28, // suivi rapide (dash, grand écart, glissé en cours, recentrage)
  fastDist: 220, // au-delà de cet écart (unités monde) le suivi passe en mode rapide
  snapDist: 1100, // au-delà : saut direct (réapparition, rappel)
  returnDelayMs: 1200, // pause avant le retour automatique après un glissé
  returnMs: 240, // constante de temps du retour (un peu moins de une seconde en tout)
  recenterBoostMs: 260, // durée du suivi rapide après un recentrage
  leadFactor: 0.3, // part du vecteur héros → visée qui décale la caméra
  leadMax: 170, // décalage maximal vers la visée
  leadMs: 130, // lissage du décalage de visée
  yOffset: 60, // le héros est un peu sous le centre de l'écran (comme avant)
  maxStepMs: 100, // un temps de frame plus long (onglet endormi) est ramené à cette valeur
};

const ease = (dt, tau) => 1 - Math.exp(-dt / tau);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createCamera(opts = {}) {
  const cfg = { ...CAMERA, ...opts };
  const s = {
    x: 0,
    y: 0,
    ready: false,
    offX: 0,
    offY: 0,
    leadX: 0,
    leadY: 0,
    dragging: false,
    held: false,
    idleMs: 0,
    boostMs: 0,
    anchorX: null,
    anchorY: null,
    snap: false,
  };

  /** Bornes de la caméra : le cadre reste dans la carte (centré si la carte est plus petite que l'écran). */
  function bounds(map, halfW, halfH) {
    return {
      minX: map.width <= halfW * 2 ? map.width / 2 : halfW,
      maxX: map.width <= halfW * 2 ? map.width / 2 : map.width - halfW,
      minY: map.height <= halfH * 2 ? map.height / 2 : halfH,
      maxY: map.height <= halfH * 2 ? map.height / 2 : map.height - halfH,
    };
  }

  return {
    /**
     * Avance la caméra et renvoie le centre à afficher.
     * `hero` : { x, y, dashing?, dead? } ou null · `aim` : { x, y } ou null · `view` : { halfW, halfH } en unités monde.
     */
    update(dtMs, { hero, aim = null, map, view }) {
      const dt = Number.isFinite(dtMs) ? Math.min(cfg.maxStepMs, Math.max(0, dtMs)) : 0;
      const b = bounds(map, view.halfW, view.halfH);
      if (!hero) {
        if (!s.ready) {
          s.x = clamp(map.width / 2, b.minX, b.maxX);
          s.y = clamp(map.height / 2, b.minY, b.maxY);
          s.ready = true;
        }
        return { x: s.x, y: s.y };
      }
      const baseX = hero.x;
      const baseY = hero.y - cfg.yOffset;

      const followX = clamp(baseX, b.minX, b.maxX);
      const followY = clamp(baseY, b.minY, b.maxY);
      // Pendant l'exploration, la vue reste ancrée au terrain, même si le héros continue à courir.
      if ((s.dragging || s.held) && s.anchorX !== null) {
        s.offX = s.anchorX - followX;
        s.offY = s.anchorY - followY;
      }

      // Retour automatique du décalage d'exploration (sauf glissé en cours ou mode libre).
      if (!s.dragging && !s.held && (s.offX !== 0 || s.offY !== 0)) {
        s.idleMs += dt;
        if (s.idleMs >= cfg.returnDelayMs) {
          const k = Math.exp(-dt / cfg.returnMs);
          s.offX *= k;
          s.offY *= k;
          if (Math.hypot(s.offX, s.offY) < 1) s.offX = s.offY = 0;
        }
      }

      // Décalage vers la visée (compétence en cours de visée).
      let tx = 0;
      let ty = 0;
      if (aim && !hero.dead && !s.dragging && !s.held && !s.snap && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
        let dx = (aim.x - hero.x) * cfg.leadFactor;
        let dy = (aim.y - hero.y) * cfg.leadFactor;
        const len = Math.hypot(dx, dy);
        if (len > cfg.leadMax) {
          dx = (dx / len) * cfg.leadMax;
          dy = (dy / len) * cfg.leadMax;
        }
        tx = dx;
        ty = dy;
      }
      const kl = ease(dt, cfg.leadMs);
      s.leadX += (tx - s.leadX) * kl;
      s.leadY += (ty - s.leadY) * kl;

      // Le décalage d'exploration est compté depuis la position de suivi déjà bornée (un héros collé au bord de la carte
      // ne crée donc aucun décalage), et ne peut pas dépasser les bords (sinon il s'accumulerait sans effet visible).
      const wantX = clamp(followX + s.offX, b.minX, b.maxX);
      const wantY = clamp(followY + s.offY, b.minY, b.maxY);
      s.offX = wantX - followX;
      s.offY = wantY - followY;
      s.anchorX = wantX;
      s.anchorY = wantY;
      const targetX = clamp(wantX + s.leadX, b.minX, b.maxX);
      const targetY = clamp(wantY + s.leadY, b.minY, b.maxY);

      if (!s.ready || s.snap) {
        s.snap = false;
        s.x = targetX;
        s.y = targetY;
        s.ready = true;
      } else {
        const dx = targetX - s.x;
        const dy = targetY - s.y;
        const d = Math.hypot(dx, dy);
        if (d > cfg.snapDist) {
          s.x = targetX;
          s.y = targetY;
        } else {
          if (s.boostMs > 0) s.boostMs = Math.max(0, s.boostMs - dt);
          const fast = hero.dashing || s.dragging || s.boostMs > 0 || d > cfg.fastDist;
          const k = ease(dt, fast ? cfg.fastMs : cfg.followMs);
          s.x += dx * k;
          s.y += dy * k;
        }
      }
      s.x = clamp(s.x, b.minX, b.maxX);
      s.y = clamp(s.y, b.minY, b.maxY);
      return { x: s.x, y: s.y };
    },

    /** Glissé : déplace le cadre de (dx, dy) unités monde (positif = la vue se déplace vers la droite / le bas). */
    pan(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (!s.dragging && !s.held) {
        s.anchorX = s.x - s.leadX;
        s.anchorY = s.y - s.leadY;
      }
      s.anchorX = (s.anchorX ?? s.x) + dx;
      s.anchorY = (s.anchorY ?? s.y) + dy;
      s.offX += dx;
      s.offY += dy;
      s.dragging = true;
      s.idleMs = 0;
    },
    /** Fin du glissé : le décalage reste un instant puis revient (sauf mode libre). */
    release() {
      s.dragging = false;
      s.idleMs = 0;
    },
    /** Recentrage immédiat : décalage effacé, mode libre quitté, héros retrouvé dès la prochaine image, même à temps nul. */
    recenter() {
      s.offX = s.offY = s.leadX = s.leadY = 0;
      s.anchorX = s.anchorY = null;
      s.snap = true;
      s.dragging = false;
      s.held = false;
      s.idleMs = 0;
      s.boostMs = cfg.recenterBoostMs;
    },
    /** Mode libre : le décalage n'est plus rendu tout seul. Quitter le mode libre lance aussitôt le retour. */
    toggleHold() {
      s.held = !s.held;
      if (s.held) {
        s.anchorX ??= s.x;
        s.anchorY ??= s.y;
        s.leadX = s.leadY = 0;
      }
      s.idleMs = s.held ? 0 : cfg.returnDelayMs;
      return s.held;
    },
    setHold(v) {
      if (v !== s.held) this.toggleHold();
    },
    /** Pour l'interface : la caméra est-elle décalée, en mode libre, en cours de glissé ? */
    state() {
      return { offset: Math.hypot(s.offX, s.offY), free: s.offX !== 0 || s.offY !== 0, held: s.held, dragging: s.dragging };
    },
    center: () => ({ x: s.x, y: s.y }),
    config: cfg,
  };
}
