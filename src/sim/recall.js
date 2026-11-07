// Rappel : danse sur place (durée de l'animation), puis retour à la base.
// Interrompu par un déplacement, une attaque lancée, une capacité ou des dégâts. Les autos sont suspendues pendant la danse
// pour qu'un verrou resté actif ne l'annule pas par inadvertance.
import { cancelSwing, emit, spawnPoint } from './world.js';

export function startRecall(world, hero) {
  if (!world.match || world.over || hero.dead || hero.cast || hero.recall) return false;
  hero.moveTarget = null;
  hero.steer = null;
  hero.path = [];
  cancelSwing(world, hero, 'recall');
  hero.recall = { t: 0, durationMs: world.match.recall.durationMs, facing: { ...hero.facing } };
  emit(world, { type: 'recall_start', heroId: hero.id });
  return true;
}

export function cancelRecall(world, hero, reason) {
  if (!hero.recall) return false;
  hero.recall = null;
  emit(world, { type: 'recall_cancel', heroId: hero.id, reason });
  return true;
}

export function updateRecall(world, hero, dtMs) {
  const r = hero.recall;
  r.t += dtMs;
  if (r.t < r.durationMs) return;
  const p = spawnPoint(world, hero.team, hero.slot);
  hero.x = p.x;
  hero.y = p.y;
  hero.recall = null;
  hero.targetId = null;
  hero.swing = null;
  emit(world, { type: 'recall_complete', heroId: hero.id });
}
