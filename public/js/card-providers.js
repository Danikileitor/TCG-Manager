// Conectores al catálogo público de cada TCG (búsqueda de cartas).
//
// Cada proveedor ofrece:
//   languages  idiomas disponibles (nombres OFICIALES, nada se traduce)
//   filters    esquema de filtros avanzados propio de ese TCG (lo dibuja catalog-search.js)
//   search(query, lang, { filters, altArts, page })
//                -> { cards, hasMore, total }
//
// Cada carta normalizada tiene la forma:
//   { cardId, name, altName, imageUrl, setCode, rarity, typeLine, statLine, zoneHint, language, isAlt }
//
// El catálogo NO se guarda en tu base de datos: solo guardas lo que posee cada
// usuario y sus mazos (referenciando cardId). Si alguna fuente cambia, solo hay que
// tocar este archivo.
//
// ESQUEMA DE FILTROS (cada campo es un objeto):
//   { id, label, type, ... }  con type:
//     'select'  options [{value,label}]                      -> un valor
//     'chips'   options [{value,label,swatch?}]              -> varios valores (lista)
//     'range'   min, max (límites), placeholder              -> { min, max }
//     'number'  min, max, placeholder                        -> un número
//     'text'    placeholder, suggestions [..] (opcional)     -> texto libre
//     'combo'   loadOptions() -> [{value,label}] (se carga al abrir los filtros)
//   Los grupos son { title, fields: [...] }.

import { api } from './api.js';

const PAGE_SIZE = 40;

function errorText(err) {
  return err && err.message ? err.message : 'No se pudo conectar con el catálogo. Revisa tu conexión e inténtalo de nuevo';
}

async function fetchJson(url, errorMessage) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error('No se pudo conectar con el catálogo. Revisa tu conexión e inténtalo de nuevo');
  }
  if (res.status === 404) return { notFound: true, data: null };
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).details || '';
    } catch (err) {
      // sin cuerpo JSON
    }
    const error = new Error(errorMessage || detail || 'El catálogo no está disponible ahora mismo');
    error.status = res.status;
    error.detail = detail;
    throw error;
  }
  return { notFound: false, data: await res.json() };
}

// ---- utilidades de filtros ----
const hasText = (v) => typeof v === 'string' && v.trim() !== '';
const toNumber = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function rangeOf(value) {
  if (!value || typeof value !== 'object') return null;
  const min = toNumber(value.min);
  const max = toNumber(value.max);
  return min === null && max === null ? null : { min, max };
}

// Texto para Scryfall: "mv>=2 mv<=4" o "mv=3"
function scryfallRange(key, value) {
  const r = rangeOf(value);
  if (!r) return [];
  if (r.min !== null && r.max !== null && r.min === r.max) return [`${key}=${r.min}`];
  const terms = [];
  if (r.min !== null) terms.push(`${key}>=${r.min}`);
  if (r.max !== null) terms.push(`${key}<=${r.max}`);
  return terms;
}

function inRange(num, r) {
  if (typeof num !== 'number') return false; // sin dato o "?"
  return (r.min === null || num >= r.min) && (r.max === null || num <= r.max);
}

function words(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Guarda en memoria lo ya descargado (y reintenta si falló)
const jsonCache = new Map();
function loadOnce(url, errorMessage) {
  if (!jsonCache.has(url)) {
    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(errorMessage);
        return res.json();
      })
      .catch((err) => {
        jsonCache.delete(url);
        throw err instanceof TypeError ? new Error(errorMessage) : err;
      });
    jsonCache.set(url, promise);
  }
  return jsonCache.get(url);
}

// ====================================================================
// Magic: The Gathering (Scryfall)
// ====================================================================
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

const MTG_COLORS = [
  { value: 'w', label: 'Blanco', swatch: '#f3e9b5' },
  { value: 'u', label: 'Azul', swatch: '#4a90d9' },
  { value: 'b', label: 'Negro', swatch: '#5a4a5e' },
  { value: 'r', label: 'Rojo', swatch: '#e0533f' },
  { value: 'g', label: 'Verde', swatch: '#3f9b5c' },
];

const MTG_FILTERS = [
  {
    title: 'Carta',
    fields: [
      {
        id: 'cardType',
        label: 'Tipo de carta',
        type: 'select',
        options: [
          { value: 'creature', label: 'Criatura' },
          { value: 'instant', label: 'Instantáneo' },
          { value: 'sorcery', label: 'Conjuro' },
          { value: 'enchantment', label: 'Encantamiento' },
          { value: 'artifact', label: 'Artefacto' },
          { value: 'planeswalker', label: 'Planeswalker' },
          { value: 'land', label: 'Tierra' },
          { value: 'battle', label: 'Batalla' },
        ],
      },
      { id: 'subtype', label: 'Subtipo o supertipo', type: 'text', placeholder: 'Ej.: legendary, elf, equipment', hint: 'En inglés, como aparece en la carta original.' },
      { id: 'oracle', label: 'Texto de reglas', type: 'text', placeholder: 'Ej.: draw a card', hint: 'En inglés (texto oracle).' },
    ],
  },
  {
    title: 'Color',
    fields: [
      {
        id: 'colors',
        label: 'Colores de la carta',
        type: 'chips',
        options: [...MTG_COLORS, { value: 'c', label: 'Incoloro', swatch: '#a8adb8' }],
      },
      {
        id: 'colorMatch',
        label: 'Cómo combinar los colores',
        type: 'select',
        noEmpty: true,
        modifier: true,
        options: [
          { value: '>=', label: 'Incluye estos colores' },
          { value: '=', label: 'Exactamente estos colores' },
          { value: '<=', label: 'Solo estos colores (o menos)' },
        ],
      },
      { id: 'identity', label: 'Identidad de color (Commander)', type: 'chips', options: MTG_COLORS, hint: 'Cartas que caben en un mazo de esa identidad.' },
    ],
  },
  {
    title: 'Números',
    fields: [
      { id: 'mv', label: 'Coste de maná convertido', type: 'range', min: 0, max: 20 },
      { id: 'power', label: 'Fuerza', type: 'range', min: 0, max: 99 },
      { id: 'toughness', label: 'Resistencia', type: 'range', min: 0, max: 99 },
    ],
  },
  {
    title: 'Edición y legalidad',
    fields: [
      { id: 'set', label: 'Edición (set)', type: 'combo', placeholder: 'Nombre o código (ej.: Zendikar, ZNR)', loadOptions: loadMtgSets },
      {
        id: 'rarity',
        label: 'Rareza',
        type: 'chips',
        options: [
          { value: 'common', label: 'Común' },
          { value: 'uncommon', label: 'Poco común' },
          { value: 'rare', label: 'Rara' },
          { value: 'mythic', label: 'Mítica' },
        ],
      },
      {
        id: 'format',
        label: 'Legal en el formato',
        type: 'select',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'pioneer', label: 'Pioneer' },
          { value: 'modern', label: 'Modern' },
          { value: 'legacy', label: 'Legacy' },
          { value: 'vintage', label: 'Vintage' },
          { value: 'commander', label: 'Commander' },
          { value: 'pauper', label: 'Pauper' },
        ],
      },
    ],
  },
];

// Lista de ediciones de Scryfall (se guarda una semana en el navegador)
const MTG_SETS_KEY = 'tcg.mtgsets.v1';
async function loadMtgSets() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MTG_SETS_KEY));
    if (saved && Date.now() - saved.at < 7 * 24 * 3600 * 1000 && Array.isArray(saved.options)) return saved.options;
  } catch (err) {
    // sin almacenamiento: se descarga cada vez
  }
  const { data } = await fetchJson('https://api.scryfall.com/sets');
  const options = ((data && data.data) || [])
    .filter((s) => !['token', 'memorabilia', 'minigame'].includes(s.set_type))
    .sort((a, b) => String(b.released_at || '').localeCompare(String(a.released_at || '')))
    .map((s) => ({ value: s.code, label: `${s.name} (${s.code.toUpperCase()})` }));
  try {
    window.localStorage.setItem(MTG_SETS_KEY, JSON.stringify({ at: Date.now(), options }));
  } catch (err) {
    // sin almacenamiento
  }
  return options;
}

// Nombre impreso en la carta: "printed_name" (o el de cada cara en cartas de dos caras).
// "name" es siempre el nombre oficial en inglés.
function mtgPrintedName(c) {
  if (c.printed_name) return c.printed_name;
  if (Array.isArray(c.card_faces) && c.card_faces.some((f) => f.printed_name)) {
    return c.card_faces.map((f) => f.printed_name || f.name).join(' // ');
  }
  return c.name;
}

// Convierte los filtros en términos de la sintaxis de búsqueda de Scryfall
// (https://scryfall.com/docs/syntax)
export function buildScryfallQuery(query, lang, filters = {}) {
  const terms = [];
  if (hasText(query)) terms.push(query.trim());

  if (hasText(filters.cardType)) terms.push(`t:${filters.cardType}`);
  words(filters.subtype).forEach((w) => terms.push(`t:${w.replace(/[^\p{L}\p{N}'-]/gu, '')}`));
  if (hasText(filters.oracle)) terms.push(`o:"${filters.oracle.trim().replace(/"/g, '')}"`);

  const colors = Array.isArray(filters.colors) ? filters.colors : [];
  if (colors.length) {
    if (colors.includes('c') && colors.length === 1) terms.push('c:c');
    else {
      const letters = colors.filter((c) => c !== 'c').join('');
      const op = ['>=', '=', '<='].includes(filters.colorMatch) ? filters.colorMatch : '>=';
      if (letters) terms.push(`c${op}${letters}`);
    }
  }
  if (Array.isArray(filters.identity) && filters.identity.length) terms.push(`id<=${filters.identity.join('')}`);

  terms.push(...scryfallRange('mv', filters.mv));
  terms.push(...scryfallRange('pow', filters.power));
  terms.push(...scryfallRange('tou', filters.toughness));

  if (hasText(filters.set)) terms.push(`s:${filters.set.trim().replace(/[^\p{L}\p{N}_-]/gu, '')}`);
  if (Array.isArray(filters.rarity) && filters.rarity.length) {
    const list = filters.rarity.map((r) => `r:${r}`);
    terms.push(list.length > 1 ? `(${list.join(' or ')})` : list[0]);
  }
  if (hasText(filters.format)) terms.push(`f:${filters.format}`);

  // lang:xx limita la búsqueda a impresiones en ese idioma (nombre, texto e imagen oficiales)
  terms.push(`lang:${lang}`);
  return terms.join(' ');
}

const scryfall = {
  languages: MTG_LANGUAGES,
  note: '',
  filters: MTG_FILTERS,
  altArtsLabel: 'Incluir artes alternativos',
  altArtsHint: 'Muestra una carta por cada ilustración distinta.',
  async search(query, lang, { filters = {}, altArts = false, page = 1 } = {}) {
    const q = buildScryfallQuery(query, lang, filters);
    // unique=art: una carta por ilustración (incluye artes alternativos); unique=cards: una por carta
    const url =
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}` +
      `&unique=${altArts ? 'art' : 'cards'}&order=name&page=${page}`;
    let result;
    try {
      result = await fetchJson(url);
    } catch (err) {
      if (err.status === 400 && err.detail) throw new Error(`Búsqueda no válida: ${err.detail}`);
      throw err;
    }
    const data = result.data;
    if (!data || !data.data) return { cards: [], hasMore: false, total: 0 };
    const cards = data.data.map((c) => {
      const face = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
      const name = mtgPrintedName(c);
      const pt = c.power !== undefined && c.toughness !== undefined ? `${c.power}/${c.toughness}` : '';
      return {
        cardId: c.id,
        name,
        altName: name !== c.name ? c.name : '', // nombre oficial en inglés, como referencia
        imageUrl: face.small || face.normal || '',
        setCode: (c.set || '').toUpperCase(),
        rarity: c.rarity || '',
        typeLine: c.printed_type_line || c.type_line || '',
        statLine: [c.mana_cost, pt].filter(Boolean).join(' · '),
        zoneHint: 'main',
        language: c.lang || lang,
        isAlt: false,
      };
    });
    return { cards, hasMore: Boolean(data.has_more), total: data.total_cards || cards.length };
  },
};

// ====================================================================
// Yu-Gi-Oh! (YGOJSON)
// ====================================================================
// Datos de https://github.com/iconmaster5326/YGOJSON con los nombres oficiales de cada
// idioma. YGOJSON no es una API de búsqueda, así que se usan archivos generados con
// scripts/build-ygo-index.mjs (carpeta public/data/ygo):
//   <idioma>.json   nombres (se descarga solo el del idioma elegido)
//   details.json    atributo, tipo, nivel, ATK/DEF... (solo al usar filtros)
//   sets.json + cardsets.json   sets de cada carta (solo al filtrar por set)
//   arts.json       artes alternativos (solo si se activan)
// El navegador busca en local, sin más peticiones. Las imágenes son las de la versión en inglés.
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

const YGO_ATTRIBUTES = [
  { value: 'dark', label: 'Oscuridad', swatch: '#7a4fa3' },
  { value: 'light', label: 'Luz', swatch: '#e6c84a' },
  { value: 'earth', label: 'Tierra', swatch: '#9a7448' },
  { value: 'water', label: 'Agua', swatch: '#3f8fd9' },
  { value: 'fire', label: 'Fuego', swatch: '#e0533f' },
  { value: 'wind', label: 'Viento', swatch: '#3fb58a' },
  { value: 'divine', label: 'Divino', swatch: '#d9a441' },
];

const YGO_RACES = [
  ['aqua', 'Aqua'], ['beast', 'Bestia'], ['beastwarrior', 'Bestia Guerrera'], ['creatorgod', 'Dios Creador'],
  ['cyberse', 'Ciberso'], ['dinosaur', 'Dinosaurio'], ['divinebeast', 'Bestia Divina'], ['dragon', 'Dragón'],
  ['fairy', 'Hada'], ['fiend', 'Demonio'], ['fish', 'Pez'], ['illusion', 'Ilusión'], ['insect', 'Insecto'],
  ['machine', 'Máquina'], ['plant', 'Planta'], ['psychic', 'Psíquico'], ['pyro', 'Piro'], ['reptile', 'Reptil'],
  ['rock', 'Roca'], ['seaserpent', 'Serpiente marina'], ['spellcaster', 'Lanzador de conjuros'],
  ['thunder', 'Trueno'], ['warrior', 'Guerrero'], ['wingedbeast', 'Bestia alada'], ['wyrm', 'Wyrm'], ['zombie', 'Zombi'],
].map(([value, label]) => ({ value, label }));

const YGO_CATEGORIES = [
  { value: 'normal', label: 'Normal' },
  { value: 'effect', label: 'Efecto' },
  { value: 'fusion', label: 'Fusión' },
  { value: 'ritual', label: 'Ritual' },
  { value: 'synchro', label: 'Sincronía' },
  { value: 'xyz', label: 'Xyz' },
  { value: 'pendulum', label: 'Péndulo' },
  { value: 'link', label: 'Enlace' },
  { value: 'tuner', label: 'Cantante' },
];

const YGO_FILTERS = [
  {
    title: 'Carta',
    fields: [
      {
        id: 'kind',
        label: 'Tipo de carta',
        type: 'select',
        options: [
          { value: 'monster', label: 'Monstruo (cualquiera)' },
          { value: 'main', label: 'Monstruo del Deck principal' },
          { value: 'extra', label: 'Monstruo del Extra Deck' },
          { value: 'spell', label: 'Carta de Magia' },
          { value: 'trap', label: 'Carta de Trampa' },
        ],
      },
      {
        id: 'sub',
        label: 'Subtipo de Magia / Trampa',
        type: 'select',
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'continuous', label: 'Continua' },
          { value: 'equip', label: 'Equipo' },
          { value: 'quickplay', label: 'Juego rápido' },
          { value: 'field', label: 'Campo' },
          { value: 'ritual', label: 'Ritual' },
          { value: 'counter', label: 'Contraefecto' },
        ],
      },
    ],
  },
  {
    title: 'Monstruo',
    fields: [
      { id: 'attribute', label: 'Atributo', type: 'chips', options: YGO_ATTRIBUTES },
      { id: 'race', label: 'Tipo de monstruo', type: 'select', options: YGO_RACES },
      { id: 'category', label: 'Categoría (deben cumplirse todas)', type: 'chips', options: YGO_CATEGORIES },
      { id: 'level', label: 'Nivel / Rango / Enlace', type: 'range', min: 0, max: 13 },
      { id: 'atk', label: 'ATK', type: 'range', min: 0, max: 10000, step: 50 },
      { id: 'def', label: 'DEF', type: 'range', min: 0, max: 10000, step: 50 },
      { id: 'scale', label: 'Escala de Péndulo', type: 'range', min: 0, max: 13 },
    ],
  },
  {
    title: 'Edición',
    fields: [
      { id: 'set', label: 'Set', type: 'combo', placeholder: 'Nombre o código (ej.: LOB, Legend of Blue Eyes)', loadOptions: loadYgoSets },
    ],
  },
];

async function loadYgoSets() {
  const sets = await loadOnce('/data/ygo/sets.json', 'No se pudo cargar la lista de sets');
  return sets.map(([code, name], i) => ({ value: String(i), label: code ? `${name} (${code})` : name }));
}

// El set llega como posición ("12") o como texto escrito a mano (código "LOB" o parte del nombre)
async function resolveYgoSet(value) {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const sets = await loadOnce('/data/ygo/sets.json', 'No se pudo cargar la lista de sets');
  const lower = text.toLowerCase();
  let idx = sets.findIndex(([code]) => code && code.toLowerCase() === lower);
  if (idx < 0) idx = sets.findIndex(([, name]) => name.toLowerCase().includes(lower));
  return idx < 0 ? null : idx;
}

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
function toSmallImage(full) {
  return full.replace('://images.ygoprodeck.com/images/cards/', '://images.ygoprodeck.com/images/cards_small/');
}

function ygoImage(row) {
  const id = row[0];
  const full = row[4] || (/^\d+$/.test(id) ? `https://images.ygoprodeck.com/images/cards/${id}.jpg` : '');
  return toSmallImage(full);
}

// Arte alternativo: "id" (imagen por defecto de YGOPRODeck) o ["id", "url"]
function ygoArt(art) {
  if (Array.isArray(art)) return { id: art[0], image: toSmallImage(art[1]) };
  return { id: art, image: `https://images.ygoprodeck.com/images/cards_small/${art}.jpg` };
}

// ¿Hay filtros activos? (sin contar el de tipo de carta, que ya está en el índice de nombres)
function ygoActiveFilters(filters) {
  const f = filters || {};
  const detail =
    hasText(f.sub) ||
    hasText(f.race) ||
    (Array.isArray(f.attribute) && f.attribute.length > 0) ||
    (Array.isArray(f.category) && f.category.length > 0) ||
    Boolean(rangeOf(f.level) || rangeOf(f.atk) || rangeOf(f.def) || rangeOf(f.scale));
  return { kind: hasText(f.kind), detail, set: hasText(f.set) };
}

function ygoKindMatches(kind, wanted) {
  if (wanted === 'monster') return kind === 'm' || kind === 'x';
  if (wanted === 'main') return kind === 'm';
  if (wanted === 'extra') return kind === 'x';
  if (wanted === 'spell') return kind === 's';
  if (wanted === 'trap') return kind === 't';
  return true;
}

// d = [atributo, tipo, nivel, ATK, DEF, categorías, subtipo, escala]
function ygoDetailsMatch(d, f) {
  if (!d) return false;
  if (hasText(f.sub) && d[6] !== f.sub) return false;
  if (hasText(f.race) && d[1] !== f.race) return false;
  if (Array.isArray(f.attribute) && f.attribute.length && !f.attribute.includes(d[0])) return false;
  if (Array.isArray(f.category) && f.category.length) {
    const tags = d[5] ? d[5].split(',') : [];
    if (!f.category.every((c) => tags.includes(c))) return false;
  }
  const checks = [[f.level, d[2]], [f.atk, d[3]], [f.def, d[4]], [f.scale, d[7]]];
  return checks.every(([value, num]) => {
    const r = rangeOf(value);
    return !r || inRange(num, r);
  });
}

function ygoStatLine(d) {
  if (!d) return '';
  const attrs = Object.fromEntries(YGO_ATTRIBUTES.map((a) => [a.value, a.label]));
  const races = Object.fromEntries(YGO_RACES.map((r) => [r.value, r.label]));
  const parts = [];
  if (d[0]) parts.push(attrs[d[0]] || d[0]);
  if (d[1]) parts.push(races[d[1]] || d[1]);
  if (d[2] !== null && d[2] !== undefined) parts.push(`${(d[5] || '').includes('xyz') ? 'Rango' : (d[5] || '').includes('link') ? 'Enlace' : 'Nivel'} ${d[2]}`);
  if (d[3] !== null && d[3] !== undefined) parts.push(`ATK ${d[3]}${d[4] !== null && d[4] !== undefined ? ` / DEF ${d[4]}` : ''}`);
  return parts.join(' · ');
}

const ygojson = {
  languages: YGO_LANGUAGES,
  note: '',
  filters: YGO_FILTERS,
  altArtsLabel: 'Incluir artes alternativos',
  altArtsHint: 'Añade las versiones con otra ilustración de cada carta.',
  async search(query, lang, { filters = {}, altArts = false, page = 1 } = {}) {
    const whole = normalizeText(query);
    const active = ygoActiveFilters(filters);
    if (!whole && !active.kind && !active.detail && !active.set) return { cards: [], hasMore: false, total: 0 };
    const tokens = whole ? whole.split(' ') : [];

    const [index, details, cardSets, arts] = await Promise.all([
      loadYgoIndex(lang),
      active.detail || altArts ? loadOnce('/data/ygo/details.json', 'No se pudo cargar los datos de las cartas') : null,
      active.set ? loadOnce('/data/ygo/cardsets.json', 'No se pudo cargar los sets') : null,
      altArts ? loadOnce('/data/ygo/arts.json', 'No se pudo cargar los artes alternativos') : null,
    ]);
    const setIndex = active.set ? await resolveYgoSet(filters.set) : null;
    if (active.set && setIndex === null) return { cards: [], hasMore: false, total: 0 };

    const found = [];
    for (const entry of index) {
      const row = entry.row;
      if (active.kind && !ygoKindMatches(row[3], filters.kind)) continue;
      let score = 1;
      if (whole) {
        // El nombre en el idioma elegido pesa más que el nombre en inglés
        score = matchScore(entry.name, tokens, whole) * 10 || matchScore(entry.alt, tokens, whole);
        if (!score) continue;
      }
      if (active.detail && !ygoDetailsMatch(details[row[0]], filters)) continue;
      if (active.set && !((cardSets[row[0]] || []).includes(setIndex))) continue;
      found.push({ entry, score });
    }
    if (whole) found.sort((a, b) => b.score - a.score || a.entry.row[1].length - b.entry.row[1].length);

    // Cada carta seguida de sus artes alternativos (si están activados)
    const list = [];
    for (const { entry } of found) {
      list.push({ entry, art: null });
      if (altArts && arts) (arts[entry.row[0]] || []).forEach((art) => list.push({ entry, art: ygoArt(art) }));
    }

    const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const cards = slice.map(({ entry, art }) => {
      const row = entry.row;
      const kind = YGO_KINDS[row[3]] || YGO_KINDS.m;
      return {
        cardId: art ? art.id : row[0],
        name: row[1],
        altName: row[2], // nombre oficial en inglés, como referencia
        imageUrl: art ? art.image : ygoImage(row),
        setCode: '',
        rarity: '',
        typeLine: kind.label,
        statLine: ygoStatLine(details && details[row[0]]),
        zoneHint: kind.zone,
        language: lang,
        isAlt: Boolean(art),
      };
    });
    return { cards, hasMore: list.length > page * PAGE_SIZE, total: list.length };
  },
};

// ====================================================================
// Digimon Card Game (digimoncard.io)
// ====================================================================
// Esta fuente solo devuelve nombres en inglés. Para añadir más idiomas habría que
// incorporar otra fuente de datos y declarar aquí sus idiomas.
const DIGIMON_COLORS = [
  { value: 'Red', label: 'Rojo' },
  { value: 'Blue', label: 'Azul' },
  { value: 'Yellow', label: 'Amarillo' },
  { value: 'Green', label: 'Verde' },
  { value: 'Black', label: 'Negro' },
  { value: 'Purple', label: 'Morado' },
  { value: 'White', label: 'Blanco' },
  { value: 'Colorless', label: 'Incoloro' },
];

const DIGIMON_FILTERS = [
  {
    title: 'Carta',
    fields: [
      {
        id: 'type',
        label: 'Tipo de carta',
        type: 'select',
        options: [
          { value: 'Digimon', label: 'Digimon' },
          { value: 'Option', label: 'Opción' },
          { value: 'Tamer', label: 'Tamer' },
          { value: 'Digi-Egg', label: 'Digi-Egg' },
        ],
      },
      { id: 'color', label: 'Color', type: 'select', options: DIGIMON_COLORS },
      { id: 'desc', label: 'Texto del efecto', type: 'text', placeholder: 'Ej.: Reveal 5 cards', hint: 'En inglés.' },
    ],
  },
  {
    title: 'Digimon',
    fields: [
      { id: 'level', label: 'Nivel', type: 'number', min: 2, max: 7, placeholder: 'Ej.: 4' },
      {
        id: 'stage',
        label: 'Etapa',
        type: 'text',
        placeholder: 'Ej.: Champion',
        suggestions: ['In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega', 'Armor', 'Hybrid'],
      },
      {
        id: 'attribute',
        label: 'Atributo',
        type: 'select',
        options: ['Vaccine', 'Data', 'Virus', 'Free', 'Variable', 'Unknown'].map((v) => ({ value: v, label: v })),
      },
      {
        id: 'digitype',
        label: 'Tipo digital (Digi-Type)',
        type: 'text',
        placeholder: 'Ej.: Dragon',
        suggestions: ['Dragon', 'Dragonkin', 'Beast', 'Machine', 'Dinosaur', 'Wizard', 'Angel', 'Holy Knight', 'Cyborg', 'Insectoid', 'Plant', 'Aquatic', 'Bird', 'Fairy', 'Mutant'],
      },
    ],
  },
  {
    title: 'Costes y poder',
    fields: [
      { id: 'playcost', label: 'Coste de juego', type: 'number', min: 0, max: 20, placeholder: 'Ej.: 5' },
      { id: 'evocost', label: 'Coste de evolución', type: 'number', min: 0, max: 8, placeholder: 'Ej.: 3' },
      { id: 'evocolor', label: 'Color de evolución', type: 'select', options: DIGIMON_COLORS },
      { id: 'dp', label: 'DP (poder)', type: 'number', min: 0, max: 20000, step: 1000, placeholder: 'Ej.: 5000' },
    ],
  },
  {
    title: 'Edición',
    fields: [
      { id: 'pack', label: 'Set / pack', type: 'text', placeholder: 'Ej.: BT-04 o Great Legend' },
      { id: 'card', label: 'Número de carta', type: 'text', placeholder: 'Ej.: BT4-016' },
      {
        id: 'rarity',
        label: 'Rareza',
        type: 'chips',
        options: [
          { value: 'C', label: 'Común' },
          { value: 'U', label: 'Poco común' },
          { value: 'R', label: 'Rara' },
          { value: 'SR', label: 'Super rara' },
          { value: 'SEC', label: 'Secreta' },
          { value: 'P', label: 'Promo' },
        ],
      },
      { id: 'artist', label: 'Ilustrador', type: 'text', placeholder: 'Nombre del artista' },
    ],
  },
];

function digimonLine(c) {
  const parts = [];
  if (c.color) parts.push(c.color2 ? `${c.color}/${c.color2}` : c.color);
  if (c.level !== null && c.level !== undefined && c.level !== '') parts.push(`Nv ${c.level}`);
  if (c.play_cost !== null && c.play_cost !== undefined && c.play_cost !== '') parts.push(`Coste ${c.play_cost}`);
  if (c.dp) parts.push(`DP ${c.dp}`);
  return parts.join(' · ');
}

// ---- Conexión con la API (https://digimoncard.io/api-documentation) ----
// La API permite llamadas desde cualquier dominio (CORS) y limita a 15 peticiones cada
// 10 segundos POR IP, así que lo normal es llamarla directamente desde el navegador de
// cada usuario. Si el navegador no puede (CORS, bloqueadores...), se usa como plan B la
// función /api/digimon-search, que hace la misma consulta desde el servidor.
const DIGIMON_API = 'https://digimoncard.io/api-public/search';
const DIGIMON_TEXT_PARAMS = ['desc', 'color', 'type', 'attribute', 'digitype', 'evocolor', 'stage', 'pack', 'card', 'artist'];
const DIGIMON_NUMBER_PARAMS = ['level', 'playcost', 'evocost', 'dp'];
const DIGIMON_LIMIT = 600;
const DIGIMON_CACHE_MS = 5 * 60 * 1000;
const digimonCache = new Map(); // consulta -> { at, cards }

// Rareza: abreviatura de la interfaz -> nombres que puede devolver la API
const DIGIMON_RARITIES = {
  C: ['c', 'common'],
  U: ['u', 'uncommon'],
  R: ['r', 'rare'],
  SR: ['sr', 'super rare'],
  SEC: ['sec', 'secret rare', 'secret'],
  P: ['p', 'promo', 'promotion'],
};

// Solo se envían a la API los parámetros que ella entiende
export function buildDigimonParams(query, filters = {}) {
  const params = new URLSearchParams({ series: 'Digimon Card Game', sort: 'name', sortdirection: 'asc', limit: String(DIGIMON_LIMIT) });
  const searchable = [];
  if (hasText(query)) {
    params.set('n', query.trim().slice(0, 80));
    searchable.push('n');
  }
  for (const key of DIGIMON_TEXT_PARAMS) {
    if (hasText(String(filters[key] ?? ''))) {
      params.set(key, String(filters[key]).trim().slice(0, 80));
      searchable.push(key);
    }
  }
  for (const key of DIGIMON_NUMBER_PARAMS) {
    if (/^\d{1,6}$/.test(String(filters[key] ?? '').trim())) {
      params.set(key, String(filters[key]).trim());
      searchable.push(key);
    }
  }
  return { params, searchable };
}

async function fetchDigimon(params) {
  const key = params.toString();
  const cached = digimonCache.get(key);
  if (cached && Date.now() - cached.at < DIGIMON_CACHE_MS) return cached.cards;

  let cards;
  let res = null;
  try {
    res = await fetch(`${DIGIMON_API}?${params}`, { headers: { Accept: 'application/json' } });
  } catch (err) {
    res = null; // sin conexión directa (CORS, bloqueador...): se usa el servidor
  }

  if (res && (res.ok || res.status === 400 || res.status === 404)) {
    // Sin resultados la API responde 400 con { error } (o 404): no es un fallo
    cards = res.ok ? await res.json().catch(() => []) : [];
  } else if (res && res.status === 429) {
    throw new Error('Demasiadas búsquedas seguidas en Digimon. Espera unos segundos e inténtalo de nuevo');
  } else {
    const data = await api.get(`/digimon-search?${params}`);
    cards = (data && data.cards) || [];
  }
  cards = Array.isArray(cards) ? cards : [];
  digimonCache.set(key, { at: Date.now(), cards });
  return cards;
}

// Filtros que la API no tiene: rareza y artes alternativos (número con "_P1", "_P2"...)
export function filterDigimonCards(cards, { rarity = [], altArts = false } = {}) {
  let list = cards;
  if (!altArts) list = list.filter((c) => !/_P\d+$/i.test(String(c.id || c.cardnumber || '')));
  const wanted = Array.isArray(rarity) ? rarity.filter((r) => DIGIMON_RARITIES[r]) : [];
  if (wanted.length) {
    list = list.filter((c) => {
      const value = String(c.rarity || c.card_rarity || '').trim().toLowerCase();
      return !value || wanted.some((w) => DIGIMON_RARITIES[w].includes(value)); // sin dato: no se descarta
    });
  }
  return list;
}

const digimon = {
  languages: [{ code: 'en', label: 'English' }],
  note: '',
  filters: DIGIMON_FILTERS,
  altArtsLabel: 'Incluir artes alternativos',
  altArtsHint: 'Incluye las versiones paralelas (Alternative Art).',
  async search(query, lang, { filters = {}, altArts = false, page = 1 } = {}) {
    const { params, searchable } = buildDigimonParams(query, filters);
    const rarity = filters.rarity || [];
    // Sin ningún criterio la API devolvería un error (o todo el catálogo)
    if (searchable.length === 0 && rarity.length === 0) return { cards: [], hasMore: false, total: 0 };
    if (searchable.length === 0) throw new Error('La rareza se combina con otro criterio: añade un nombre, un color, un tipo u otro filtro');

    const list = filterDigimonCards(await fetchDigimon(params), { rarity, altArts });
    const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const cards = slice.map((c) => {
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
        statLine: digimonLine(c),
        zoneHint: /egg/i.test(type) ? 'digi-egg' : 'main',
        language: 'en',
        isAlt: /_P\d+$/i.test(String(id)),
      };
    });
    return { cards, hasMore: list.length > page * PAGE_SIZE, total: list.length };
  },
};

// ====================================================================
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

// Esquema de filtros avanzados del TCG: [{ title, fields }]
export function getFilterSchema(gameKey) {
  return (providers[gameKey] && providers[gameKey].filters) || [];
}

// Textos del interruptor de artes alternativos del TCG
export function getAltArtsInfo(gameKey) {
  const p = providers[gameKey] || {};
  return { label: p.altArtsLabel || 'Incluir artes alternativos', hint: p.altArtsHint || '' };
}

// ¿Hay algún filtro con valor? (para permitir buscar sin escribir un nombre)
export function hasActiveFilters(filters) {
  return Object.values(filters || {}).some((v) => {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return rangeOf(v) !== null;
    return hasText(String(v ?? ''));
  });
}

export async function searchCatalog(gameKey, query, lang, options = {}) {
  const provider = providers[gameKey];
  if (!provider) throw new Error('Este TCG todavía no tiene catálogo');
  const codes = provider.languages.map((l) => l.code);
  const safeLang = codes.includes(lang) ? lang : codes[0];
  try {
    return await provider.search(String(query || '').trim(), safeLang, options);
  } catch (err) {
    throw new Error(errorText(err));
  }
}
