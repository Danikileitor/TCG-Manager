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

// ---------- Yu-Gi-Oh! (YGOJSON) ----------
// Datos de https://github.com/iconmaster5326/YGOJSON con los nombres oficiales de cada
// idioma. YGOJSON no es una API de búsqueda, así que se usa un índice generado con
// scripts/build-ygo-index.mjs (archivos public/data/ygo/<idioma>.json, uno por idioma).
// El navegador descarga solo el del idioma elegido (la primera vez que se busca) y busca
// en local, sin más peticiones. Las imágenes son las de la versión en inglés.
const YGO_LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zhs', label: '简体中文' },
  { code: 'zht', label: '繁體中文' },
];

// Tipo de carta del índice -> etiqueta de la interfaz y zona del mazo
const YGO_KINDS = {
  m: { label: 'Monstruo', zone: 'main' },
  x: { label: 'Monstruo de Extra Deck', zone: 'extra' },
  s: { label: 'Carta de Magia', zone: 'main' },
  t: { label: 'Carta de Trampa', zone: 'main' },
};

// Minúsculas, sin acentos y con caracteres de ancho completo normalizados ("Ａ" -> "a")
function normalizeText(text) {
  return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const ygoIndexes = new Map(); // idioma -> Promise con el índice ya preparado

function loadYgoIndex(lang) {
  if (!ygoIndexes.has(lang)) {
    const promise = fetch(`/data/ygo/${lang}.json`)
      .then((res) => {
        if (!res.ok) throw new Error('No se pudo cargar el catálogo de Yu-Gi-Oh!');
        return res.json();
      })
      .then((rows) => rows.map((row) => ({ row, name: normalizeText(row[1]), alt: normalizeText(row[2]) })));
    promise.catch(() => ygoIndexes.delete(lang)); // si falla, se reintenta en la siguiente búsqueda
    ygoIndexes.set(lang, promise);
  }
  return ygoIndexes.get(lang);
}

// 0 = no coincide; más alto = mejor coincidencia
function matchScore(text, tokens, whole) {
  if (!text || !tokens.every((t) => text.includes(t))) return 0;
  if (text === whole) return 4;
  if (text.startsWith(whole)) return 3;
  if (text.split(' ').some((word) => word.startsWith(tokens[0]))) return 2;
  return 1;
}

// Imagen pequeña de la carta (YGOJSON usa las de YGOPRODeck y Yugipedia)
function ygoImage(row) {
  const id = row[0];
  const full = row[4] || (/^\d+$/.test(id) ? `https://images.ygoprodeck.com/images/cards/${id}.jpg` : '');
  return full.replace('://images.ygoprodeck.com/images/cards/', '://images.ygoprodeck.com/images/cards_small/');
}

const ygojson = {
  languages: YGO_LANGUAGES,
  note: 'Solo aparecen las cartas con nombre oficial en este idioma. Las imágenes son las de la versión en inglés.',
  async search(query, lang) {
    const whole = normalizeText(query);
    if (!whole) return [];
    const tokens = whole.split(' ');
    const index = await loadYgoIndex(lang);

    const found = [];
    for (const entry of index) {
      // El nombre en el idioma elegido pesa más que el nombre en inglés
      const score = matchScore(entry.name, tokens, whole) * 10 || matchScore(entry.alt, tokens, whole);
      if (score) found.push({ entry, score });
    }
    found.sort((a, b) => b.score - a.score || a.entry.row[1].length - b.entry.row[1].length);

    return found.slice(0, 30).map(({ entry }) => {
      const row = entry.row;
      const kind = YGO_KINDS[row[3]] || YGO_KINDS.m;
      return {
        cardId: row[0],
        name: row[1],
        altName: row[2], // nombre oficial en inglés, como referencia
        imageUrl: ygoImage(row),
        setCode: '',
        rarity: '',
        typeLine: kind.label,
        zoneHint: kind.zone,
        language: lang,
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

const providers = { mtg: scryfall, ygo: ygojson, digimon };
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
