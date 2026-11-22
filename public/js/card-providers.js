// Conectores al catálogo público de cada TCG (búsqueda de cartas).
//
// Cada proveedor ofrece:
//   languages  idiomas disponibles (nombres OFICIALES, nada se traduce)
//   filters    esquema de filtros avanzados propio de ese TCG (lo dibuja catalog-search.js)
//   search(query, lang, { filters, altArts, page })
//                -> { cards, hasMore, total }
//
// Cada carta normalizada tiene la forma:
//   { cardId, name, altName, imageUrl, imageBack, backKind, setCode, rarity, typeLine, statLine, zoneHint, language, isAlt }
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
      { id: 'subtype', label: 'Subtipo o supertipo', type: 'text', placeholder: 'Escribe o elige de la lista', suggest: suggestMtgTypes },
      { id: 'oracle', label: 'Texto de reglas', type: 'text', placeholder: 'Palabras que debe contener el texto' },
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

// ---- Subtipos y supertipos en el idioma elegido ----
// Scryfall no ofrece traducciones de los tipos. Se aprenden de las propias cartas: cada carta
// trae su línea de tipo oficial en inglés ("Legendary Creature — Elf Warrior") y la impresa en
// su idioma ("Criatura legendaria — Elfo guerrero"); emparejándolas se obtiene la lista de
// palabras de ese idioma y su equivalente en inglés. Se descarga una muestra de cartas la
// primera vez que se usa un idioma y se guarda una semana en el navegador.
const MTG_TYPES_KEY = 'tcg.mtgtypes.v1.';
const MTG_TYPES_TTL = 7 * 24 * 3600 * 1000;
const MTG_CRAWL_PLAN = [['edhrec', 1], ['edhrec', 2], ['edhrec', 3], ['released', 1], ['released', 2], ['power', 1], ['toughness', 1], ['cmc', 1]];
const MTG_CATALOGS = ['supertypes', 'card-types', 'creature-types', 'planeswalker-types', 'land-types', 'artifact-types', 'enchantment-types', 'spell-types', 'battle-types'];
const mtgTypeStates = new Map(); // idioma -> { words: Map(norm -> texto), dict: Map(norm -> inglés), loading }

const isCjk = (text) => /[぀-ヿ㐀-鿿가-힯]/.test(text);

function newTypeState() {
  return { words: new Map(), dict: new Map(), loading: null };
}

function addTypeWord(state, word) {
  const clean = String(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!clean || clean.length < (isCjk(clean) ? 1 : 3) || /^\d+$/.test(clean)) return null;
  const key = normalizeText(clean);
  if (!state.words.has(key)) state.words.set(key, clean.charAt(0).toLocaleUpperCase() + clean.slice(1));
  return key;
}

function splitTypeLine(line) {
  if (!line || line.includes('//')) return null; // cartas de dos caras: se ignoran
  const [before, after = ''] = String(line).split(/\s*—\s*/);
  const tokens = (side) => side.split(/[\s・·]+/).filter(Boolean);
  return { before: tokens(before), after: tokens(after) };
}

// Aprende palabras y equivalencias de las cartas devueltas por Scryfall.
// Solo se empareja cuando es seguro: palabra única en ambas líneas, o por eliminación
// (el resto de palabras ya se conocen). No se adivina por posición, porque el orden de las
// palabras cambia según el idioma.
export function learnMtgTypes(state, cards) {
  const pending = [];
  const clean = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  for (const c of cards) {
    const en = splitTypeLine(c.type_line);
    const loc = splitTypeLine(c.printed_type_line);
    if (!loc) continue;
    [...loc.before, ...loc.after].forEach((w) => addTypeWord(state, w));
    if (!en) continue;
    for (const side of ['before', 'after']) {
      if (en[side].length !== loc[side].length || en[side].length === 0) continue;
      if (en[side].length === 1) {
        const key = normalizeText(clean(loc[side][0]));
        if (key && state.words.has(key) && !state.dict.has(key)) state.dict.set(key, clean(en[side][0]));
      } else {
        pending.push({ en: en[side].map(clean), loc: loc[side].map((w) => normalizeText(clean(w))) });
      }
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const item of pending) {
      const known = new Set();
      const unknownLoc = [];
      item.loc.forEach((key) => {
        if (state.dict.has(key)) known.add(normalizeText(state.dict.get(key)));
        else unknownLoc.push(key);
      });
      const unknownEn = item.en.filter((w) => !known.has(normalizeText(w)));
      if (unknownLoc.length === 1 && unknownEn.length === 1 && state.words.has(unknownLoc[0])) {
        state.dict.set(unknownLoc[0], unknownEn[0]);
      }
    }
  }
}

function readTypeCache(lang) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MTG_TYPES_KEY + lang));
    if (saved && Date.now() - saved.at < MTG_TYPES_TTL) return saved;
  } catch (err) {
    // sin almacenamiento
  }
  return null;
}

function saveTypeCache(lang, state) {
  try {
    window.localStorage.setItem(
      MTG_TYPES_KEY + lang,
      JSON.stringify({ at: Date.now(), words: [...state.words.values()], dict: [...state.dict.entries()] })
    );
  } catch (err) {
    // sin almacenamiento
  }
}

async function crawlMtgTypes(lang, state, onUpdate) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let got = false;
  if (lang === 'en') {
    // En inglés, Scryfall publica las listas completas
    for (const name of MTG_CATALOGS) {
      try {
        const { data } = await fetchJson(`https://api.scryfall.com/catalog/${name}`);
        ((data && data.data) || []).forEach((w) => addTypeWord(state, w));
        got = true;
        onUpdate();
      } catch (err) {
        break;
      }
      await pause(100);
    }
  } else {
    for (const [order, page] of MTG_CRAWL_PLAN) {
      try {
        const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`lang:${lang}`)}&unique=cards&order=${order}&dir=desc&page=${page}`;
        const { data } = await fetchJson(url);
        if (data && data.data) {
          learnMtgTypes(state, data.data);
          got = true;
          onUpdate();
        }
      } catch (err) {
        break; // límite de peticiones o sin conexión: se queda con lo aprendido
      }
      await pause(100);
    }
  }
  if (got) saveTypeCache(lang, state);
}

// Estado de los tipos de un idioma: lo guardado en el navegador o, si no hay, lo empieza a descargar
export function ensureMtgTypes(lang, onUpdate = () => {}) {
  let state = mtgTypeStates.get(lang);
  if (!state) {
    state = newTypeState();
    mtgTypeStates.set(lang, state);
    const cached = readTypeCache(lang);
    if (cached) {
      cached.words.forEach((w) => addTypeWord(state, w));
      state.dict = new Map(cached.dict);
    } else {
      state.loading = crawlMtgTypes(lang, state, onUpdate).finally(() => {
        state.loading = null;
        onUpdate();
      });
    }
  }
  return state;
}

// Sugerencias para el campo de subtipo: la última palabra escrita se completa con los tipos del idioma
export function suggestMtgTypes(text, lang, onUpdate) {
  const state = ensureMtgTypes(lang, onUpdate);
  const match = /^(.*\s)?(\S*)$/.exec(text || '');
  const prefix = (match && match[1]) || '';
  const start = normalizeText((match && match[2]) || '');
  return [...state.words.entries()]
    .filter(([key]) => key.startsWith(start))
    .map(([, shown]) => shown)
    .sort((a, b) => a.localeCompare(b, lang === 'zhs' || lang === 'zht' ? 'zh' : lang))
    .slice(0, 80)
    .map((shown) => prefix + shown);
}

// Convierte los filtros en términos de la sintaxis de búsqueda de Scryfall
// (https://scryfall.com/docs/syntax)
export function buildScryfallQuery(query, lang, filters = {}, typeDict = null) {
  const terms = [];
  if (hasText(query)) terms.push(query.trim());

  if (hasText(filters.cardType)) terms.push(`t:${filters.cardType}`);
  words(filters.subtype).forEach((w) => {
    const clean = w.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (!clean) return;
    // Si se conoce el equivalente en inglés del tipo escrito en otro idioma, se buscan ambos
    const english = typeDict && typeDict.get(normalizeText(clean));
    terms.push(english && normalizeText(english) !== normalizeText(clean) ? `(t:${english} or t:${clean})` : `t:${clean}`);
  });
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
  async search(query, lang, { filters = {}, altArts = false, page = 1 } = {}) {
    const q = buildScryfallQuery(query, lang, filters, hasText(filters.subtype) ? ensureMtgTypes(lang).dict : null);
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
    if (!data || !data.data) {
      const emptyNote =
        lang !== 'en' && hasText(filters.oracle)
          ? 'Sin resultados. Scryfall puede buscar el texto de reglas solo en el original en inglés: prueba también a quitar el texto de reglas.'
          : '';
      return { cards: [], hasMore: false, total: 0, emptyNote };
    }
    const cards = data.data.map((c) => {
      const face = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
      // Cartas de dos caras: la segunda cara tiene su propia imagen
      const backFace = !c.image_uris && c.card_faces && c.card_faces[1] && c.card_faces[1].image_uris;
      const name = mtgPrintedName(c);
      const pt = c.power !== undefined && c.toughness !== undefined ? `${c.power}/${c.toughness}` : '';
      return {
        cardId: c.id,
        name,
        altName: name !== c.name ? c.name : '', // nombre oficial en inglés, como referencia
        imageUrl: face.small || face.normal || '',
        imageBack: (backFace && (backFace.small || backFace.normal)) || '',
        setCode: (c.set || '').toUpperCase(),
        rarity: c.rarity || '',
        typeLine: c.printed_type_line || c.type_line || '',
        facets: mtgFacets(c),
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
        facets: details ? ygoFacets(row[3], details[row[0]]) : null,
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

// ¿Es una versión alternativa? La API no lo documenta, así que se miran varias pistas:
// número con sufijo "_P1", "_P2"... (también en pretty_url) o "Alternate Art"/"Parallel" en el nombre de TCGplayer.
export function isDigimonAlt(c) {
  const id = String(c.id || c.cardnumber || c.card_number || '');
  return (
    /_P\d+$/i.test(id) ||
    /-p\d+$/i.test(String(c.pretty_url || '')) ||
    /alternat(e|ive)[ -]art|parallel/i.test(String(c.tcgplayer_name || ''))
  );
}

// Si una versión alternativa llega con el mismo número que la normal, se le da un número propio
// (<número>_P1, _P2...) para que sea una carta distinta con su propia imagen.
export function normalizeDigimonAlts(cards) {
  const seen = new Set();
  const count = {};
  return cards.map((c) => {
    const id = String(c.id || c.cardnumber || c.card_number || '');
    const alt = isDigimonAlt(c);
    let finalId = id;
    if (alt && !/_P\d+$/i.test(id)) {
      const base = id.replace(/_P\d+$/i, '');
      count[base] = (count[base] || 0) + 1;
      finalId = `${base}_P${count[base]}`;
    } else if (!alt && seen.has(id)) {
      return null; // duplicado exacto de una carta normal
    }
    seen.add(finalId);
    return { ...c, id: finalId, _alt: alt };
  }).filter(Boolean);
}

// Filtros que la API no tiene: rareza y artes alternativos
export function filterDigimonCards(cards, { rarity = [], altArts = false } = {}) {
  let list = normalizeDigimonAlts(cards);
  if (!altArts) list = list.filter((c) => !c._alt);
  const wanted = Array.isArray(rarity) ? rarity.filter((r) => DIGIMON_RARITIES[r]) : [];
  if (wanted.length) {
    list = list.filter((c) => {
      const value = String(c.rarity || c.card_rarity || '').trim().toLowerCase();
      return !value || wanted.some((w) => DIGIMON_RARITIES[w].includes(value)); // sin dato: no se descarta
    });
  }
  return list;
}

// Artes alternativos: la API de digimoncard.io no los devuelve, así que se añaden desde
// /data/digimon/arts.json (generado por scripts/build-digimon-arts.mjs). Las imágenes se piden al
// servidor de imágenes de la comunidad, con el nombre <carta>_P<n>.webp.
const DIGIMON_ALT_IMG = 'https://web-garage.takaotaku.de/';

// Añade, tras cada carta normal, sus versiones alternativas (las que la API ya haya devuelto no se repiten)
export function addDigimonAlts(cards, arts) {
  const known = (arts && arts.cards) || {};
  const labels = (arts && arts.labels) || [];
  const have = new Set(cards.map((c) => String(c.id)));
  const out = [];
  for (const c of cards) {
    out.push(c);
    if (c._alt) continue;
    for (const [n, labelId, imageId] of known[c.id] || []) {
      const altId = `${c.id}_P${n}`;
      if (have.has(altId)) continue;
      have.add(altId);
      out.push({ ...c, id: altId, image_url: `${DIGIMON_ALT_IMG}${imageId || altId}.webp`, set_name: labels[labelId] || c.set_name, _alt: true });
    }
  }
  return out;
}

const digimon = {
  languages: [{ code: 'en', label: 'English' }],
  note: '',
  filters: DIGIMON_FILTERS,
  altArtsLabel: 'Incluir artes alternativos',
  async search(query, lang, { filters = {}, altArts = false, page = 1 } = {}) {
    const { params, searchable } = buildDigimonParams(query, filters);
    const rarity = filters.rarity || [];
    // Sin ningún criterio la API devolvería un error (o todo el catálogo)
    if (searchable.length === 0 && rarity.length === 0) return { cards: [], hasMore: false, total: 0 };
    if (searchable.length === 0) throw new Error('La rareza se combina con otro criterio: añade un nombre, un color, un tipo u otro filtro');

    const list = filterDigimonCards(await fetchDigimon(params), { rarity, altArts });
    let slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (altArts) slice = addDigimonAlts(slice, await loadOnce('/data/digimon/arts.json', 'No se pudo cargar los artes alternativos de Digimon'));
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
        facets: digimonFacets(c),
        statLine: digimonLine(c),
        zoneHint: /egg/i.test(type) ? 'digi-egg' : 'main',
        backKind: /egg/i.test(type) ? 'egg' : '', // los Digi-Egg tienen un dorso distinto
        language: 'en',
        isAlt: Boolean(c._alt),
      };
    });
    return { cards, hasMore: list.length > page * PAGE_SIZE, total: list.length };
  },
};

// ====================================================================
const providers = { mtg: scryfall, ygo: ygojson, digimon };
const FALLBACK_LANGUAGES = [{ code: 'en', label: 'English' }];

// Idiomas que ofrece el catálogo de un TCG: [{ code, label }]

// ====================================================================
// Datos para filtrar "Mi colección" (facets)
// ====================================================================
// Cada carta guardada lleva un objeto pequeño con lo necesario para filtrar sin consultar el catálogo:
//   { colors: [], types: [], subtypes: [], attribute: '', cost: n, level: n, power: n }
// Los de MTG y Digimon vienen ya en los resultados de búsqueda; los de Yu-Gi-Oh! salen de los archivos locales.
// Para las cartas guardadas antes de existir esto, facetsForCards() los consulta una vez.
const cleanNum = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

export function mtgFacets(c) {
  const faces = Array.isArray(c.card_faces) ? c.card_faces : [];
  const colors = [...new Set([...(c.colors || []), ...(c.colors ? [] : faces.flatMap((f) => f.colors || []))])];
  if (!colors.length) colors.push('C');
  const types = new Set();
  const subtypes = new Set();
  for (const part of String(c.type_line || '').split('//')) {
    const [left, right] = part.split('—');
    left.trim().split(/\s+/).filter(Boolean).forEach((t) => types.add(t));
    (right || '').trim().split(/\s+/).filter(Boolean).forEach((t) => subtypes.add(t));
  }
  return { colors, types: [...types], subtypes: [...subtypes], cost: cleanNum(c.cmc), power: cleanNum(c.power !== undefined ? c.power : faces[0] && faces[0].power) };
}

export function digimonFacets(c) {
  const type = c.type || c.card_type || '';
  return {
    colors: [c.color, c.color2].filter(Boolean),
    types: type ? [type] : [],
    subtypes: [c.digi_type, c.digi_type2, c.digi_type3, c.digi_type4, c.digi_type5, c.form].filter(Boolean),
    attribute: c.attribute || '',
    cost: cleanNum(c.play_cost),
    level: cleanNum(c.level),
    power: cleanNum(c.dp),
  };
}

const YGO_SUB_LABELS = { normal: 'Normal', continuous: 'Continua', equip: 'Equipo', quickplay: 'Juego rápido', field: 'Campo', ritual: 'Ritual', counter: 'Contraefecto' };

export function ygoFacets(kindKey, d) {
  const kind = YGO_KINDS[kindKey] || YGO_KINDS.m;
  const types = [kindKey === 's' ? 'Magia' : kindKey === 't' ? 'Trampa' : 'Monstruo'];
  if (kindKey === 'x') types.push('Extra Deck');
  const cats = Object.fromEntries(YGO_CATEGORIES.map((c) => [c.value, c.label]));
  const attrs = Object.fromEntries(YGO_ATTRIBUTES.map((a) => [a.value, a.label]));
  const races = Object.fromEntries(YGO_RACES.map((r) => [r.value, r.label]));
  const out = { colors: [], types, subtypes: [], attribute: '', cost: null, level: null, power: null };
  if (!d) return out;
  (d[5] ? d[5].split(',') : []).forEach((t) => cats[t] && types.push(cats[t]));
  if (d[6]) out.subtypes.push(YGO_SUB_LABELS[d[6]] || d[6]);
  if (d[1]) out.subtypes.push(races[d[1]] || d[1]);
  out.attribute = attrs[d[0]] || d[0] || '';
  out.level = cleanNum(d[2]);
  out.power = cleanNum(d[3]);
  return out;
}

async function mtgFacetsFor(cards, onProgress) {
  const result = new Map();
  const ids = [...new Set(cards.map((c) => c.cardId))];
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    let res;
    try {
      res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
      });
    } catch (err) {
      break;
    }
    if (!res.ok) break;
    const data = await res.json().catch(() => null);
    ((data && data.data) || []).forEach((c) => result.set(c.id, mtgFacets(c)));
    onProgress(Math.min(i + 75, ids.length), ids.length);
    if (i + 75 < ids.length) await new Promise((r) => setTimeout(r, 120)); // Scryfall pide ~10 peticiones/s como máximo
  }
  return result;
}

async function ygoFacetsFor(cards) {
  const result = new Map();
  const [index, details, arts] = await Promise.all([
    loadYgoIndex('en'),
    loadOnce('/data/ygo/details.json', 'No se pudo cargar los datos de las cartas'),
    loadOnce('/data/ygo/arts.json', 'No se pudo cargar los artes alternativos').catch(() => ({})),
  ]);
  const byId = new Map(index.map((e) => [String(e.row[0]), e.row]));
  // Un arte alternativo tiene su propio cardId: se busca la carta a la que pertenece
  const owner = new Map();
  for (const [base, list] of Object.entries(arts || {})) list.forEach((a) => owner.set(String(Array.isArray(a) ? a[0] : a), base));
  for (const c of cards) {
    const id = String(c.cardId);
    const baseId = byId.has(id) ? id : owner.get(id);
    const row = baseId && byId.get(baseId);
    if (row) result.set(c.cardId, ygoFacets(row[3], details[baseId]));
  }
  return result;
}

async function digimonFacetsFor(cards, onProgress) {
  const result = new Map();
  const bases = [...new Set(cards.map((c) => String(c.cardId).replace(/_P\d+$/i, '')))];
  const found = new Map();
  let done = 0;
  for (const base of bases) {
    try {
      const list = await fetchDigimon(new URLSearchParams({ series: 'Digimon Card Game', card: base, limit: '5' }));
      const hit = list.find((c) => String(c.id || c.cardnumber) === base);
      if (hit) found.set(base, digimonFacets(hit));
    } catch (err) {
      break; // límite de la API o sin conexión: se completará en otra visita
    }
    onProgress(++done, bases.length);
    await new Promise((r) => setTimeout(r, 750)); // la API admite 15 peticiones cada 10 s
  }
  for (const c of cards) {
    const f = found.get(String(c.cardId).replace(/_P\d+$/i, ''));
    if (f) result.set(c.cardId, f);
  }
  return result;
}

// Devuelve Map(cardId -> facets) para las cartas indicadas ({cardId}); las que no se encuentran faltan en el mapa
export async function facetsForCards(gameKey, cards, onProgress = () => {}) {
  if (!cards.length) return new Map();
  if (gameKey === 'mtg') return mtgFacetsFor(cards, onProgress);
  if (gameKey === 'yugioh' || gameKey === 'ygo') return ygoFacetsFor(cards);
  if (gameKey === 'digimon') return digimonFacetsFor(cards, onProgress);
  return new Map();
}

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
