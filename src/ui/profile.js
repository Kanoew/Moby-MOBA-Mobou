// Profil du joueur : monnaie, personnages possédés, personnage choisi. Stocké en local (navigateur).
// Aucun paiement réel : les « Éclats » se gagnent en jouant. Fonctions pures + stockage injectable (testable).

const KEY = 'moba.profile.v1';

export function defaultProfile(roster) {
  return {
    coins: roster.currency.start,
    owned: roster.characters.filter((c) => c.starter).map((c) => c.id),
    selected: roster.characters.find((c) => c.starter).id,
    matches: 0,
    wins: 0,
  };
}

export function loadProfile(storage, roster) {
  const base = defaultProfile(roster);
  try {
    const raw = storage && storage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw);
    const known = new Set(roster.characters.map((c) => c.id));
    const owned = (Array.isArray(p.owned) ? p.owned : base.owned).filter((id) => known.has(id));
    for (const id of base.owned) if (!owned.includes(id)) owned.push(id); // le personnage de départ reste acquis
    return {
      coins: Number.isFinite(p.coins) && p.coins >= 0 ? Math.floor(p.coins) : base.coins,
      owned,
      selected: owned.includes(p.selected) ? p.selected : base.selected,
      matches: Number.isFinite(p.matches) ? p.matches : 0,
      wins: Number.isFinite(p.wins) ? p.wins : 0,
    };
  } catch {
    return base;
  }
}

export function saveProfile(storage, profile) {
  try {
    if (storage) storage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* stockage plein ou interdit : le profil reste valable pour la session */
  }
}

export function resetProfile(storage) {
  try {
    if (storage) storage.removeItem(KEY);
  } catch {
    /* sans effet */
  }
}

/** Achat d'un personnage. Retourne { ok, reason }. Ne modifie rien en cas d'échec. */
export function buyCharacter(profile, roster, id) {
  const c = roster.characters.find((x) => x.id === id);
  if (!c) return { ok: false, reason: 'inconnu' };
  if (profile.owned.includes(id)) return { ok: false, reason: 'déjà possédé' };
  if (profile.coins < c.price) return { ok: false, reason: 'éclats insuffisants' };
  profile.coins -= c.price;
  profile.owned.push(id);
  return { ok: true, reason: '' };
}

export function selectCharacter(profile, id) {
  if (!profile.owned.includes(id)) return false;
  profile.selected = id;
  return true;
}

/** Récompense de fin de partie : retourne le nombre d'éclats gagnés. */
export function rewardMatch(profile, roster, outcome) {
  const gain = roster.rewards[outcome] ?? 0;
  profile.coins += gain;
  profile.matches += 1;
  if (outcome === 'win') profile.wins += 1;
  return gain;
}
