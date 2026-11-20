// Catálogo de TCG soportados. Se siembra en la colección "games" si está vacía.
// Para añadir un TCG nuevo: añade un objeto aquí (o inserta un documento en Atlas).
const DEFAULT_GAMES = [
  {
    key: 'mtg',
    name: 'Magic: The Gathering',
    short: 'MTG',
    description: 'El TCG original. Colecciona y construye mazos Commander, Standard y más.',
    color: '#7c3aed',
    deckZones: ['main', 'side', 'commander'],
    formats: ['standard', 'modern', 'pioneer', 'commander', 'legacy', 'vintage', 'pauper', 'casual'],
    enabled: true,
    order: 1,
  },
  {
    key: 'ygo',
    name: 'Yu-Gi-Oh!',
    short: 'YGO',
    description: 'Organiza tu colección y crea mazos con Main Deck, Extra Deck y Side Deck.',
    color: '#d97706',
    deckZones: ['main', 'extra', 'side'],
    formats: ['advanced', 'traditional', 'speed-duel', 'casual'],
    enabled: true,
    order: 2,
  },
  {
    key: 'digimon',
    name: 'Digimon Card Game',
    short: 'DCG',
    description: 'Gestiona tus cartas y arma mazos con Digi-Egg Deck y Main Deck.',
    color: '#0891b2',
    deckZones: ['main', 'digi-egg'],
    formats: ['standard', 'casual'],
    enabled: true,
    order: 3,
  },
];

const VALID_GAME_KEYS = DEFAULT_GAMES.map((g) => g.key);

async function getGames(db) {
  const col = db.collection('games');
  const count = await col.countDocuments();
  if (count === 0) {
    await col.insertMany(DEFAULT_GAMES);
  }
  return col.find({ enabled: true }).sort({ order: 1 }).project({ _id: 0 }).toArray();
}

module.exports = { DEFAULT_GAMES, VALID_GAME_KEYS, getGames };
