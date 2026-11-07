// Données du tableau des scores (pures, testées) : deux blocs de trois lignes à l'ordre stable.
// Ligne : portrait, pseudo, niveau, éliminations / morts / assistances, trois emplacements d'objets.
export function scoreRows(world, localId) {
  const localTeam = (world.byId.get(localId) || world.heroes[0]).team;
  const order = [localTeam, localTeam === 'ally' ? 'enemy' : 'ally'];
  return {
    timeMs: world.time,
    teams: order.map((team) => ({
      team,
      isLocalTeam: team === localTeam,
      kills: world.stats[team].kills,
      towers: world.stats[team].towers,
      rows: world.heroes
        .filter((h) => h.team === team)
        .map((h) => ({
          id: h.id,
          key: h.key,
          name: h.def.name,
          level: h.level,
          kills: h.kills,
          deaths: h.deaths,
          assists: h.assists,
          items: [...h.items],
          dead: h.dead,
          respawnIn: h.dead && h.respawnAt !== null ? Math.max(0, Math.ceil((h.respawnAt - world.time) / 1000)) : 0,
          local: h.id === localId,
        })),
    })),
  };
}
