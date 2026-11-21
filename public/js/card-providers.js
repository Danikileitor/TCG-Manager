// Conectores al catálogo público de cada TCG (búsqueda de cartas).
// Cada proveedor devuelve cartas normalizadas:
//   { cardId, name, altName, imageUrl, setCode, rarity, typeLine, zoneHint, language }
//
// IDIOMAS: se usan los NOMBRES OFICIALES que publica cada catálogo para cada idioma.
// No se traduce nada: si una carta no tiene versión en el idioma elegido, no aparece
// (o aparece con el nombre que el catálogo tenga). Cada proveedor declara los idiomas
// que realmente ofrece su fuente de datos.
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
// Idiomas de impresión de Scryfall: https://scryfall.com/docs/api/languages
const MTG_LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'ru', label: 'Русский' },
  { code: 'zhs', label: '简体中文' },
  { code: 'zht', label: '繁體中文' },
];

// Nombre impreso en la carta: "printed_name" (o el de cada cara en cartas de dos caras).
// "name" es siempre el nombre oficial en inglés.
function mtgPrintedName(c) {
  if (c.printed_name) return c.printed_name;
  if (Array.isArray(c.card_faces) && c.card_faces.some((f) => f.printed_name)) {
    return c.card_faces.map((f) => f.printed_name || f.name).join(' // ');
  }
  return c.name;
}

const scryfall = {
  languages: MTG_LANGUAGES,
  note: 'Solo aparecen las cartas que se han impreso en este idioma, con su nombre e imagen oficiales.',
  async search(query, lang) {
    // lang:xx limita la búsqueda a impresiones en ese idioma (nombre, texto e imagen oficiales)
    const q = `${query} lang:${lang}`;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`;
    const data = await getJson(url);
    if (!data || !data.data) return [];
    return data.data.slice(0, 30).map((c) => {
      const face = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
      const name = mtgPrintedName(c);
      return {
        cardId: c.id,
        name,
        altName: name !== c.name ? c.name : '', // nombre oficial en inglés, como referencia
        imageUrl: face.small || face.normal || '',
        setCode: (c.set || '').toUpperCase(),
        rarity: c.rarity || '',
        typeLine: c.printed_type_line || c.type_line || '',
        zoneHint: 'main',
        language: c.lang || lang,
      };
    });
  },
};

// ---------- Yu-Gi-Oh! (YGOPRODeck) ----------
// La API admite el parámetro "language": fr, de, it, pt (el inglés es el valor por defecto).
// No ofrece español. Las imágenes solo existen en inglés.
const YGO_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

const EXTRA_DECK_TYPES = ['Fusion', 'Synchro', 'XYZ', 'Link'];

const ygoprodeck = {
  languages: YGO_LANGUAGES,
  note: 'La fuente de datos de Yu-Gi-Oh! no ofrece español. Las imágenes de las cartas solo están en inglés.',
  async search(query, lang) {
    const langParam = lang && lang !== 'en' ? `&language=${encodeURIComponent(lang)}` : '';
    const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}${langParam}&num=30&offset=0`;
    const data = await getJson(url);
    if (!data || !data.data) return [];
    return data.data.map((c) => {
      const isExtra = EXTRA_DECK_TYPES.some((t) => (c.type || '').includes(t));
      const img = (c.card_images && c.card_images[0]) || {};
      const set = (c.card_sets && c.card_sets[0]) || {};
      return {
        cardId: String(c.id),
        name: c.name,
        altName: '',
        imageUrl: img.image_url_small || img.image_url || '',
        setCode: set.set_code || '',
        rarity: set.set_rarity || '',
        typeLine: c.type || '',
        zoneHint: isExtra ? 'extra' : 'main',
        language: lang || 'en',
      };
    });
  },
};

// ---------- Digimon Card Game (digimoncard.io) ----------
// Esta fuente solo devuelve nombres en inglés. Para añadir más idiomas habría que
// incorporar otra fuente de datos y declarar aquí sus idiomas.
// Nota: comprueba la documentación de la API (https://digimoncard.io/index.php/api-documentation)
// por si cambian los nombres de los campos o las condiciones de CORS.
const digimon = {
  languages: [{ code: 'en', label: 'English' }],
  note: 'La fuente de datos de Digimon solo ofrece nombres en inglés por ahora.',
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
        altName: '',
        imageUrl: c.image_url || (id ? `https://images.digimoncard.io/images/cards/${id}.jpg` : ''),
        setCode: Array.isArray(c.set_name) ? c.set_name[0] || '' : c.set_name || '',
        rarity: c.card_rarity || c.rarity || '',
        typeLine: type,
        zoneHint: /egg/i.test(type) ? 'digi-egg' : 'main',
        language: 'en',
      };
    });
  },
};

const providers = { mtg: scryfall, ygo: ygoprodeck, digimon };
const FALLBACK_LANGUAGES = [{ code: 'en', label: 'English' }];

// Idiomas que ofrece el catálogo de un TCG: [{ code, label }]
export function getLanguages(gameKey) {
  return (providers[gameKey] && providers[gameKey].languages) || FALLBACK_LANGUAGES;
}

// Aviso para mostrar bajo el selector de idioma (limitaciones de la fuente de datos)
export function getLanguageNote(gameKey) {
  return (providers[gameKey] && providers[gameKey].note) || '';
}

export async function searchCatalog(gameKey, query, lang) {
  const provider = providers[gameKey];
  if (!provider) throw new Error('Este TCG todavía no tiene catálogo');
  const codes = provider.languages.map((l) => l.code);
  const safeLang = codes.includes(lang) ? lang : codes[0];
  return provider.search(query.trim(), safeLang);
}
