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
  t.move = (uid, to, pos = 'end') => {
    const at = t.find(uid);
    if (!at || !t.zones[to]) return false;
    snapshot();
    const [card] = t.zones[at.zone].splice(at.index, 1);
    card.tapped = false;
    card.faceDown = to === 'security' ? true : false;
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
