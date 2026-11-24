// Límite de copias por carta en un mazo según el TCG y el formato.
//   MTG: 4 por nombre (1 en Commander). Sin límite: tierras básicas y cartas que lo permiten (Relentless Rats…).
//   Yu-Gi-Oh!: 3 por carta entre Main, Extra y Side.
//   Digimon: 4 por número de carta (las versiones alternativas _P1, _P2… cuentan como la misma carta).
// No incluye listas de prohibidas / limitadas.
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const MTG_BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest)$|^wastes$/;
const MTG_ANY_NUMBER = new Set([
  'relentless rats', 'rat colony', 'shadowborn apostle', 'persistent petitioners', "dragon's approach",
  'slime against humanity', 'hare apparent', 'tempest hawk',
]);
const MTG_SPECIAL = { 'seven dwarves': 7, 'nazgul': 9 };

// Clave que identifica "la misma carta" aunque sea otra edición o idioma
export function copyKey(gameKey, card) {
  if (gameKey === 'digimon') return String(card.cardId || '').replace(/_P\d+$/i, '').toUpperCase();
  return norm(card.altName || card.name); // el nombre en inglés si lo hay (otros idiomas guardan el original en altName)
}

export function copyLimit(gameKey, format, card) {
  if (gameKey === 'mtg') {
    const key = copyKey(gameKey, card);
    if (MTG_BASIC.test(key) || MTG_ANY_NUMBER.has(key)) return Infinity;
    if (MTG_SPECIAL[key]) return MTG_SPECIAL[key];
    return format === 'commander' ? 1 : 4;
  }
  if (gameKey === 'ygo') return 3;
  if (gameKey === 'digimon') return 4;
  return 99;
}

// Copias de esa carta que ya hay en el mazo (en todas las zonas)
export function copiesInDeck(gameKey, cards, card, except = null) {
  const key = copyKey(gameKey, card);
  return cards.reduce((sum, c) => (c !== except && copyKey(gameKey, c) === key ? sum + c.quantity : sum), 0);
}

// Cuántas copias más se pueden añadir (Infinity si no hay límite)
export function copiesLeft(gameKey, format, cards, card, except = null) {
  const limit = copyLimit(gameKey, format, card);
  return limit === Infinity ? Infinity : Math.max(0, limit - copiesInDeck(gameKey, cards, card, except));
}

// Cartas que superan el límite (p. ej. tras cambiar de formato): [{ name, count, limit }]
export function overLimit(gameKey, format, cards) {
  const seen = new Map();
  for (const c of cards) {
    const key = copyKey(gameKey, c);
    if (!seen.has(key)) seen.set(key, { name: c.altName || c.name, count: 0, limit: copyLimit(gameKey, format, c) });
    seen.get(key).count += c.quantity;
  }
  return [...seen.values()].filter((x) => x.count > x.limit);
}
