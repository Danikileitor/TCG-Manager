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

// Códigos de idioma que acepta la API para las cartas (los de Scryfall; YGO y Digimon usan un subconjunto)
const VALID_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'ru', 'zhs', 'zht'];

// Caché en memoria de la instancia de la función: mientras la función siga "caliente"
// no se consulta MongoDB en cada visita a la home (la lista casi nunca cambia).
const CACHE_TTL_MS = 5 * 60 * 1000;
let gamesCache = { games: null, at: 0 };

async function getGames(db) {
  if (gamesCache.games && Date.now() - gamesCache.at < CACHE_TTL_MS) {
    return gamesCache.games;
  }

  const col = db.collection('games');
  const count = await col.countDocuments();
  if (count === 0) {
    // Se insertan copias para no modificar DEFAULT_GAMES (insertMany añade _id)
    await col.insertMany(DEFAULT_GAMES.map((g) => ({ ...g })));
  }
  const games = await col.find({ enabled: true }).sort({ order: 1 }).project({ _id: 0 }).toArray();
  gamesCache = { games, at: Date.now() };
  return games;
}

module.exports = { DEFAULT_GAMES, VALID_GAME_KEYS, VALID_LANGUAGES, getGames };
