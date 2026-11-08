// Préférence de rendu uniquement ; la réduction des animations du système reste prioritaire.
export function createEffectsPreference(storage, media = { matches: false }) {
  let selected = 'full';
  try { if (storage?.getItem('moba.effects') === 'light') selected = 'light'; } catch { /* stockage privé */ }
  return {
    mode: () => media.matches ? 'light' : selected,
    systemReduced: () => !!media.matches,
    set(mode) {
      selected = mode === 'light' ? 'light' : 'full';
      try { storage?.setItem('moba.effects', selected); } catch { /* préférence valable pour cette session */ }
    },
  };
}
