// Recherche de chemin : A* sur grille grossière, puis lissage par ligne de vue.
// Sert aux ordres de déplacement (joueur comme bots) pour contourner rochers et blocs.

const CELL = 20;

/** Un cercle de rayon r centré en (x, y) touche-t-il un obstacle ou un bord ? */
export function isBlocked(map, x, y, r) {
  const rr = r * 0.98;
  if (x < rr || y < rr || x > map.width - rr || y > map.height - rr) return true;
  for (const o of map.obstacles) {
    if (o.type === 'circle') {
      if (Math.hypot(x - o.x, y - o.y) < o.r + rr) return true;
    } else {
      const cx = Math.min(o.x + o.w / 2, Math.max(o.x - o.w / 2, x));
      const cy = Math.min(o.y + o.h / 2, Math.max(o.y - o.h / 2, y));
      if (Math.hypot(x - cx, y - cy) < rr) return true;
    }
  }
  return false;
}

function lineClear(map, a, b, r) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / 8));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (isBlocked(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) return false;
  }
  return true;
}

function nearestFree(map, p, r) {
  if (!isBlocked(map, p.x, p.y, r)) return { x: p.x, y: p.y };
  for (let ring = 1; ring < 60; ring++) {
    let best = null;
    let bestD = Infinity;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const q = { x: p.x + dx * CELL, y: p.y + dy * CELL };
        if (!isBlocked(map, q.x, q.y, r)) {
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bestD) {
            best = q;
            bestD = d;
          }
        }
      }
    }
    if (best) return best;
  }
  return { x: p.x, y: p.y };
}

class Heap {
  constructor() {
    this.a = [];
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/**
 * Chemin de `from` vers `to` pour un cercle de rayon r.
 * Retourne la liste des points à rejoindre (le dernier est la destination, ajustée si elle est dans un obstacle).
 */
export function findPath(map, r, from, to) {
  const goalPt = nearestFree(map, to, r);
  if (lineClear(map, from, goalPt, r)) return [goalPt];

  const cols = Math.ceil(map.width / CELL);
  const rows = Math.ceil(map.height / CELL);
  const cx = (c) => c * CELL + CELL / 2;
  const cy = (rw) => rw * CELL + CELL / 2;
  const toCell = (p) => ({
    c: Math.min(cols - 1, Math.max(0, Math.floor(p.x / CELL))),
    r: Math.min(rows - 1, Math.max(0, Math.floor(p.y / CELL))),
  });
  const free = new Map();
  const isFree = (c, rw) => {
    const k = rw * cols + c;
    if (!free.has(k)) free.set(k, !isBlocked(map, cx(c), cy(rw), r));
    return free.get(k);
  };

  const s = toCell(from);
  const g = toCell(goalPt);
  const open = new Heap();
  const best = new Map();
  const prev = new Map();
  const key = (c, rw) => rw * cols + c;
  const h = (c, rw) => Math.hypot(c - g.c, rw - g.r);
  best.set(key(s.c, s.r), 0);
  open.push({ c: s.c, r: s.r, g: 0, f: h(s.c, s.r) });
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (cur.c === g.c && cur.r === g.r) {
      found = true;
      break;
    }
    if (cur.g > best.get(key(cur.c, cur.r))) continue;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const nc = cur.c + dc;
        const nr = cur.r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || !isFree(nc, nr)) continue;
        if (dc && dr && (!isFree(cur.c + dc, cur.r) || !isFree(cur.c, cur.r + dr))) continue; // pas de coupe en diagonale
        const ng = cur.g + (dc && dr ? 1.414 : 1);
        const k = key(nc, nr);
        if (ng < (best.get(k) ?? Infinity)) {
          best.set(k, ng);
          prev.set(k, key(cur.c, cur.r));
          open.push({ c: nc, r: nr, g: ng, f: ng + h(nc, nr) });
        }
      }
    }
  }
  if (!found) return [goalPt];

  const cells = [];
  for (let k = key(g.c, g.r); k !== undefined; k = prev.get(k)) cells.push({ x: cx(k % cols), y: cy(Math.floor(k / cols)) });
  cells.reverse();
  cells[cells.length - 1] = goalPt;

  // Lissage : on saute les points intermédiaires tant que la ligne de vue reste libre.
  const out = [];
  let anchor = from;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineClear(map, anchor, cells[j], r)) j--;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}
