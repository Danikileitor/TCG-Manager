// Lógica pura del simulador de mano inicial (sin DOM): barajar, robar, mulligan según el TCG.
//   MTG: 7 cartas, mulligan de Londres (se roban 7 y se ponen N al fondo, N = mulligans hechos)
//   Yu-Gi-Oh!: 5 cartas, sin mulligan (solo se puede barajar y repartir de nuevo para practicar)
//   Digimon: 5 cartas, un único mulligan (se devuelve la mano al mazo, se baraja y se roban 5)
export const HAND_RULES = {
  mtg: { size: 7, mulligan: 'london', maxMulligans: 6 },
  ygo: { size: 5, mulligan: null, maxMulligans: 0 },
  digimon: { size: 5, mulligan: 'redraw', maxMulligans: 1 },
};
const DEFAULT_RULES = { size: 5, mulligan: null, maxMulligans: 0 };

export const rulesFor = (gameKey) => HAND_RULES[gameKey] || DEFAULT_RULES;

export function secureRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

// Fisher-Yates (modifica y devuelve el mismo array)
export function shuffle(list, rnd = secureRandom) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Una instancia por copia de cada carta de la zona principal del mazo
export function expandDeck(cards, zone = 'main') {
  const out = [];
  let uid = 0;
  for (const c of cards || []) {
    if ((c.zone || 'main') !== zone) continue;
    for (let i = 0; i < (c.quantity || 1); i++) out.push({ ...c, uid: uid++ });
  }
  return out;
}

export function createHandSim(deckCards, gameKey, rnd = secureRandom) {
  const rules = rulesFor(gameKey);
  const all = expandDeck(deckCards);
  const sim = {
    rules,
    total: all.length,
    library: [],
    hand: [],
    mulligans: 0,
    pendingBottom: 0, // MTG: cartas que hay que poner al fondo tras el mulligan
    get canDraw() { return sim.pendingBottom === 0 && sim.library.length > 0; },
    get canMulligan() {
      return Boolean(rules.mulligan) && sim.pendingBottom === 0 && sim.mulligans < rules.maxMulligans && sim.total > 0
        && (rules.mulligan !== 'london' || sim.hand.length > 1);
    },

    // Mano nueva desde cero: se juntan todas las cartas, se baraja y se roba
    deal() {
      sim.library = shuffle(all.slice(), rnd);
      sim.hand = [];
      sim.mulligans = 0;
      sim.pendingBottom = 0;
      sim.drawMany(rules.size);
      return sim.hand.slice();
    },
    drawMany(n) {
      const drawn = [];
      for (let i = 0; i < n && sim.library.length; i++) drawn.push(sim.library.shift());
      sim.hand.push(...drawn);
      return drawn;
    },
    draw() {
      if (!sim.canDraw) return null;
      return sim.drawMany(1)[0];
    },
    mulligan() {
      if (!sim.canMulligan) return false;
      sim.library.push(...sim.hand);
      sim.hand = [];
      shuffle(sim.library, rnd);
      sim.mulligans += 1;
      sim.drawMany(rules.size);
      if (rules.mulligan === 'london') sim.pendingBottom = Math.min(sim.mulligans, sim.hand.length - 1);
      return true;
    },
    // MTG: pone al fondo del mazo las cartas elegidas (uids); deben ser exactamente pendingBottom
    bottom(uids) {
      if (sim.pendingBottom === 0 || new Set(uids).size !== sim.pendingBottom) return false;
      const chosen = sim.hand.filter((c) => uids.includes(c.uid));
      if (chosen.length !== sim.pendingBottom) return false;
      sim.hand = sim.hand.filter((c) => !uids.includes(c.uid));
      sim.library.push(...chosen);
      sim.pendingBottom = 0;
      return true;
    },
  };
  return sim;
}
