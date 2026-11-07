// Vision partagée et symétrique. Le terrain reste connu, les unités mobiles ne laissent aucune trace.
export const VISION_RADII = { hero: 750, minion: 370, tower: 560, core: 600 };

export function visionSources(world, team) {
  return world.units.filter((u) => !u.dead && u.team === team && VISION_RADII[u.kind]);
}

export function pointVisibleTo(world, team, x, y) {
  if (!world.match || team === 'neutral') return true;
  return visionSources(world, team).some((u) => (u.x - x) ** 2 + (u.y - y) ** 2 <= VISION_RADII[u.kind] ** 2);
}

export function unitVisibleTo(world, unit, team) {
  if (unit.team === team) return true;
  return !unit.invisible && pointVisibleTo(world, team, unit.x, unit.y);
}
