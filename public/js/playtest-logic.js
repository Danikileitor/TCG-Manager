// Lógica pura (sin DOM) del modo "Partida de prueba": mesa en solitario para practicar un mazo.
// Zonas: library, hand, field, graveyard, exile y una extra según el juego (command / extra / egg) más security (Digimon).
import { shuffle, secureRandom, expandDeck, rulesFor } from './hand-logic.js';

export const ZONE_DEFS = {
  mtg: { labels: { library: 'Biblioteca', hand: 'Mano', field: 'Campo de batalla', graveyard: 'Cementerio', exile: 'Exilio', extra: 'Zona de mando' }, extraZone: 'commander', extraId: 'extra' },
  ygo: { labels: { library: 'Deck', hand: 'Mano', field: 'Campo', graveyard: 'Cementerio', exile: 'Desterradas', extra: 'Extra Deck' }, extraZone: 'extra', extraId: 'extra' },
  digimon: { labels: { library: 'Mazo', hand: 'Mano', field: 'Campo', graveyard: 'Descarte', exile: 'Exilio', extra: 'Digi-Egg Deck', security: 'Seguridad' }, extraZone: 'digi-egg', extraId: 'extra', securitySize: 5 },
};
const FALLBACK = { labels: { library: 'Mazo', hand: 'Mano', field: 'Campo', graveyard: 'Cementerio', exile: 'Exilio' }, extraZone: null };
export const defsFor = (gameKey) => ZONE_DEFS[gameKey] || FALLBACK;
export const zoneIdsFor = (gameKey) => Object.keys(defsFor(gameKey).labels);

// ---------- Tablero de cada juego ----------
// Rejilla de cols x rows celdas. Cada celda es una pila (zona), un hueco (slot, una carta) o un área libre (varias cartas
// que se colocan solas en filas). La misma descripción dibuja la mesa 2D y la 3D.
//   pile: { kind: 'pile', zone, c, r }
//   slot: { kind: 'slots', area, label, cells: [[c, r], ...] }  (un hueco por celda)
//   free: { kind: 'free', area, label, c, r, w, h }
export const LAYOUTS = {
  // Magia: una columna de pilas y el campo de batalla con la fila de tierras aparte
  mtg: {
    cols: 9, rows: 4, theme: 'mtg',
    cells: [
      { kind: 'pile', zone: 'library', c: 0, r: 0 }, { kind: 'pile', zone: 'graveyard', c: 0, r: 1 },
      { kind: 'pile', zone: 'exile', c: 0, r: 2 }, { kind: 'pile', zone: 'extra', c: 0, r: 3 },
      { kind: 'free', area: 'permanents', label: 'Criaturas y otros permanentes', c: 1, r: 0, w: 8, h: 3 },
      { kind: 'free', area: 'lands', label: 'Tierras', c: 1, r: 3, w: 8, h: 1 },
    ],
  },
  // Yu-Gi-Oh!: el tapete oficial (zonas de monstruo extra, monstruos, magias/trampas, campo, cementerio, mazo y extra deck)
  ygo: {
    cols: 7, rows: 3, theme: 'ygo',
    cells: [
      { kind: 'slots', area: 'emz', label: 'Monstruo extra', cells: [[2, 0], [4, 0]] },
      { kind: 'pile', zone: 'exile', c: 6, r: 0 },
      { kind: 'slots', area: 'fieldspell', label: 'Magia de campo', cells: [[0, 1]] },
      { kind: 'slots', area: 'monster', label: 'Zona de monstruos', cells: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]] },
      { kind: 'pile', zone: 'graveyard', c: 6, r: 1 },
      { kind: 'pile', zone: 'extra', c: 0, r: 2 },
      { kind: 'slots', area: 'spell', label: 'Magias y trampas', cells: [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2]] },
      { kind: 'pile', zone: 'library', c: 6, r: 2 },
    ],
  },
  // Digimon (tapete oficial): pila de seguridad a la izquierda, zona de batalla grande en el centro (ahí van también tamers y
  // opciones, no tienen zona propia), Mazo sobre Descarte a la derecha y, abajo a la izquierda, el mazo de Digi-Egg junto a la zona de cría
  digimon: {
    cols: 8, rows: 4, theme: 'digimon',
    cells: [
      { kind: 'pile', zone: 'security', c: 0, r: 0 },
      { kind: 'pile', zone: 'exile', c: 0, r: 1 },
      { kind: 'free', area: 'battle', label: 'Zona de batalla', c: 1, r: 0, w: 6, h: 3 },
      { kind: 'pile', zone: 'library', c: 7, r: 1 },
      { kind: 'pile', zone: 'graveyard', c: 7, r: 2 },
      { kind: 'pile', zone: 'extra', c: 1, r: 3 },
      { kind: 'slots', area: 'breeding', label: 'Zona de cría', cells: [[2, 3]] },
    ],
  },
};
const DEFAULT_LAYOUT = {
  cols: 8, rows: 3, theme: 'generic',
  cells: [
    { kind: 'pile', zone: 'library', c: 0, r: 0 }, { kind: 'pile', zone: 'graveyard', c: 0, r: 1 }, { kind: 'pile', zone: 'exile', c: 0, r: 2 },
    { kind: 'free', area: 'field', label: 'Campo', c: 1, r: 0, w: 7, h: 3 },
  ],
};
export const layoutFor = (gameKey) => LAYOUTS[gameKey] || DEFAULT_LAYOUT;
export const areasOf = (gameKey) => layoutFor(gameKey).cells.filter((c) => c.kind !== 'pile');

// A qué área del tablero va una carta que se juega sin indicar el destino
export function areaFor(gameKey, card) {
  const f = card.facets || {};
  const types = f.types || [];
  const has = (t) => types.includes(t);
  if (gameKey === 'mtg') return has('Land') ? 'lands' : 'permanents';
  if (gameKey === 'ygo') {
    if (has('Magia') && (f.subtypes || []).includes('Campo')) return 'fieldspell';
    if (has('Magia') || has('Trampa')) return 'spell';
    return 'monster';
  }
  if (gameKey === 'digimon') {
    if (card.zone === 'digi-egg' || has('Digi-Egg')) return 'breeding';
    return 'battle';
  }
  return 'field';
}

const HISTORY_MAX = 60;

export function createPlaytest(deckCards, gameKey, rnd = secureRandom) {
  const defs = defsFor(gameKey);
  const rules = rulesFor(gameKey);
  const main = expandDeck(deckCards, 'main');
  const extraCards = defs.extraZone ? expandDeck(deckCards, defs.extraZone).map((c) => ({ ...c, uid: c.uid + 100000 })) : [];
  const fresh = (c) => ({ ...c, tapped: false, faceDown: false });

  const t = {
    gameKey,
    rules,
    turn: 1,
    mulligans: 0,
    zones: {},
    history: [],
    get total() { return main.length; },
    get canUndo() { return t.history.length > 0; },
    get canMulligan() { return Boolean(rules.mulligan) && t.mulligans < rules.maxMulligans && t.turn === 1; },
  };

  function snapshot() {
    t.history.push(JSON.stringify({ zones: t.zones, turn: t.turn, mulligans: t.mulligans }));
    if (t.history.length > HISTORY_MAX) t.history.shift();
  }
  function setup() {
    t.zones = { library: shuffle(main.map(fresh), rnd), hand: [], field: [], graveyard: [], exile: [], extra: extraCards.map(fresh) };
    if (defs.securitySize) t.zones.security = [];
    t.turn = 1;
    t.mulligans = 0;
    deal();
  }
  // Mano inicial (y, en Digimon, la pila de seguridad)
  function deal() {
    for (let i = 0; i < rules.size && t.zones.library.length; i++) t.zones.hand.push(t.zones.library.shift());
    if (defs.securitySize) for (let i = 0; i < defs.securitySize && t.zones.library.length; i++) t.zones.security.push({ ...t.zones.library.shift(), faceDown: true });
  }

  t.find = (uid) => {
    for (const [zone, list] of Object.entries(t.zones)) {
      const index = list.findIndex((c) => c.uid === uid);
      if (index >= 0) return { zone, index, card: list[index] };
    }
    return null;
  };

  t.draw = (n = 1) => {
    if (!t.zones.library.length) return [];
    snapshot();
    const drawn = [];
    for (let i = 0; i < n && t.zones.library.length; i++) drawn.push(t.zones.library.shift());
    t.zones.hand.push(...drawn);
    return drawn;
  };
  t.shuffleLibrary = () => {
    snapshot();
    shuffle(t.zones.library, rnd);
  };
  // pos: 'end' (por defecto), 'top' o 'bottom' (solo importa en la biblioteca y en pilas)
  // opts (solo al campo): { area, slot } destino en el tablero; sin ellos se elige según el tipo de carta
  t.move = (uid, to, pos = 'end', opts = {}) => {
    const at = t.find(uid);
    if (!at || !t.zones[to]) return false;
    snapshot();
    const [card] = t.zones[at.zone].splice(at.index, 1);
    const stays = to === 'field' && at.zone === 'field'; // dentro del campo se conserva si está girada o boca abajo
    const prevArea = card.area;
    if (!stays) { card.tapped = false; card.faceDown = to === 'security'; }
    delete card.area;
    delete card.slot;
    if (to === 'field') {
      const area = opts.area || (stays && prevArea) || areaFor(gameKey, card);
      const def = areasOf(gameKey).find((a) => a.area === area) || areasOf(gameKey)[0];
      card.area = def.area;
      if (def.kind === 'slots') {
        const used = new Set(t.zones.field.filter((c) => c.area === def.area).map((c) => c.slot));
        const free = def.cells.findIndex((_, i) => !used.has(i));
        card.slot = Number.isInteger(opts.slot) ? opts.slot : free >= 0 ? free : 0;
      }
    }
    if (pos === 'top') t.zones[to].unshift(card);
    else t.zones[to].push(card); // 'bottom' y 'end' coinciden: la biblioteca se lee desde el principio y su fondo es el final
    return true;
  };
  t.toggleTap = (uid) => {
    const at = t.find(uid);
    if (!at || at.zone !== 'field') return false;
    snapshot();
    at.card.tapped = !at.card.tapped;
    return true;
  };
  t.toggleFace = (uid) => {
    const at = t.find(uid);
    if (!at) return false;
    snapshot();
    at.card.faceDown = !at.card.faceDown;
    return true;
  };
  // Las n cartas de arriba de la biblioteca al cementerio
  t.mill = (n = 1) => {
    if (!t.zones.library.length) return [];
    snapshot();
    const out = t.zones.library.splice(0, n);
    t.zones.graveyard.push(...out);
    return out;
  };
  t.nextTurn = () => {
    snapshot();
    t.turn += 1;
    t.zones.field.forEach((c) => (c.tapped = false));
    if (t.zones.library.length) t.zones.hand.push(t.zones.library.shift());
  };
  // Mulligan según el juego (ver hand-logic.js). MTG: Londres (roba 7 y pone N al fondo, lo decide el jugador con move(...,'bottom')).
  t.mulligan = () => {
    if (!t.canMulligan) return false;
    snapshot();
    const keep = t.mulligans + 1;
    for (const z of ['hand', 'security']) if (t.zones[z]) { t.zones.library.push(...t.zones[z].splice(0).map(fresh)); }
    shuffle(t.zones.library, rnd);
    t.mulligans = keep;
    deal();
    return true;
  };
  t.reset = () => {
    t.history = [];
    setup();
  };
  t.undo = () => {
    const last = t.history.pop();
    if (!last) return false;
    const s = JSON.parse(last);
    t.zones = s.zones;
    t.turn = s.turn;
    t.mulligans = s.mulligans;
    return true;
  };

  setup();
  return t;
}
