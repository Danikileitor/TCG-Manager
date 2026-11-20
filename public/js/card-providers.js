// Conectores al catálogo público de cada TCG (búsqueda de cartas).
// Cada proveedor devuelve cartas normalizadas:
//   { cardId, name, imageUrl, setCode, rarity, typeLine, zoneHint }
//
// El catálogo NO se guarda en tu base de datos: solo guardas lo que posee cada
// usuario y sus mazos (referenciando cardId). Si alguna API cambia, solo hay que
// tocar este archivo.

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null; // Scryfall responde 404 si no hay resultados
  if (!res.ok) throw new Error('El catálogo no está disponible ahora mismo');
  return res.json();
}

// ---------- Magic: The Gathering (Scryfall) ----------
const scryfall = {
  async search(query) {
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`;
    const data = await getJson(url);
    if (!data || !data.data) return [];
    return data.data.slice(0, 30).map((c) => {
      const face = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
      return {
        cardId: c.id,
        name: c.name,
        imageUrl: face.small || face.normal || '',
        setCode: (c.set || '').toUpperCase(),
        rarity: c.rarity || '',
        typeLine: c.type_line || '',
        zoneHint: 'main',
      };
    });
  },
};

// ---------- Yu-Gi-Oh! (YGOPRODeck) ----------
const EXTRA_DECK_TYPES = ['Fusion', 'Synchro', 'XYZ', 'Link'];

const ygoprodeck = {
  async search(query) {
    const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}&num=30&offset=0`;
    const data = await getJson(url);
    if (!data || !data.data) return [];
    return data.data.map((c) => {
      const isExtra = EXTRA_DECK_TYPES.some((t) => (c.type || '').includes(t));
      const img = (c.card_images && c.card_images[0]) || {};
      const set = (c.card_sets && c.card_sets[0]) || {};
      return {
        cardId: String(c.id),
        name: c.name,
        imageUrl: img.image_url_small || img.image_url || '',
        setCode: set.set_code || '',
        rarity: set.set_rarity || '',
        typeLine: c.type || '',
        zoneHint: isExtra ? 'extra' : 'main',
      };
    });
  },
};

// ---------- Digimon Card Game (digimoncard.io) ----------
// Nota: comprueba la documentación de la API (https://digimoncard.io/index.php/api-documentation)
// por si cambian los nombres de los campos o las condiciones de CORS.
const digimon = {
  async search(query) {
    const url =
      'https://digimoncard.io/api-public/search.php?series=Digimon%20Card%20Game&sort=name&sortdirection=asc' +
      `&n=${encodeURIComponent(query)}`;
    const data = await getJson(url);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 40).map((c) => {
      const id = c.id || c.cardnumber || c.card_number || c.name;
      const type = c.type || c.card_type || '';
      return {
        cardId: String(id),
        name: c.name,
        imageUrl: c.image_url || (id ? `https://images.digimoncard.io/images/cards/${id}.jpg` : ''),
        setCode: Array.isArray(c.set_name) ? c.set_name[0] || '' : c.set_name || '',
        rarity: c.card_rarity || c.rarity || '',
        typeLine: type,
        zoneHint: /egg/i.test(type) ? 'digi-egg' : 'main',
      };
    });
  },
};

const providers = { mtg: scryfall, ygo: ygoprodeck, digimon };

export async function searchCatalog(gameKey, query) {
  const provider = providers[gameKey];
  if (!provider) throw new Error('Este TCG todavía no tiene catálogo');
  return provider.search(query.trim());
}
