// Importar y exportar colecciones y mazos en los formatos más habituales.
// Este módulo es puro (sin red ni DOM): convierte entre el texto de cada formato y una lista de
// "entradas" ({ quantity, name, set, number, cardId, language, finish, condition, zone... }).
// Convertir las entradas en cartas reales (con imagen, datos...) lo hace card-providers.js (resolveEntries).

// ---------------------------------------------------------------- utilidades
const LANG_NAMES = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja', korean: 'ko',
  russian: 'ru', 'chinese simplified': 'zhs', 'simplified chinese': 'zhs', 'chinese traditional': 'zht', 'traditional chinese': 'zht',
  espanol: 'es', ingles: 'en', frances: 'fr', aleman: 'de', italiano: 'it', portugues: 'pt', japones: 'ja', coreano: 'ko', ruso: 'ru',
};
const LANG_CODES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'ru', 'zhs', 'zht'];
const LANG_EXPORT = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', zhs: 'Chinese Simplified', zht: 'Chinese Traditional' };

const stripAccents = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (v) => stripAccents(v).toLowerCase().trim();
const key = (v) => norm(v).replace(/[^a-z0-9]/g, '');

export function parseLanguage(value) {
  const v = norm(value);
  if (!v) return '';
  if (LANG_CODES.includes(v)) return v;
  if (v === 'zh-cn' || v === 'zh') return 'zhs';
  if (v === 'zh-tw') return 'zht';
  return LANG_NAMES[v] || '';
}

export function parseCondition(value) {
  const v = norm(value);
  if (!v) return '';
  if (['m', 'nm', 'ex', 'gd', 'lp', 'pl', 'po'].includes(v)) return v.toUpperCase();
  if (/^mint$/.test(v) || v === 'mt') return 'M';
  if (/near|nm/.test(v)) return 'NM';
  if (/excellent/.test(v)) return 'EX';
  if (/slight|light|lp/.test(v)) return 'LP';
  if (/good/.test(v)) return 'GD';
  if (/moderate|mp|played|pl/.test(v)) return 'PL';
  if (/heav|hp|poor|damag|dmg/.test(v)) return 'PO';
  return '';
}
const CONDITION_EXPORT = { M: 'Mint', NM: 'Near Mint', EX: 'Near Mint', GD: 'Lightly Played', LP: 'Lightly Played', PL: 'Moderately Played', PO: 'Heavily Played' };

export function parseFinish(value) {
  const v = norm(value);
  if (!v || ['normal', 'nonfoil', 'non-foil', 'false', 'no', '0', 'regular'].includes(v)) return v ? 'normal' : '';
  if (/etched/.test(v)) return 'etched';
  if (/foil|true|yes|^1$|holo/.test(v)) return 'foil';
  if (/1st|first/.test(v)) return '1st';
  if (/unlimited/.test(v)) return 'unlimited';
  if (/limited/.test(v)) return 'limited';
  return '';
}

const clampQty = (n) => Math.max(1, Math.min(999, parseInt(n, 10) || 1));

// ---------------------------------------------------------------- CSV
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => (firstLine.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length;
  const delimiter = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';

// Nombres de columna conocidos (Moxfield, ManaBox, Archidekt, Deckbox, DragonShield, genérico...)
const COLUMN_ALIASES = {
  quantity: ['count', 'quantity', 'qty', 'amount', 'cantidad', 'copies', 'owned', 'cardcount'],
  name: ['name', 'cardname', 'card', 'nombre', 'englishname'],
  set: ['edition', 'setcode', 'set', 'editioncode', 'setabbr', 'expansion', 'setname', 'editionname'],
  number: ['collectornumber', 'cardnumber', 'number', 'collectorsnumber', 'cardno', 'no'],
  scryfallId: ['scryfallid'],
  cardId: ['cardid', 'id', 'passcode', 'konamiid'],
  language: ['language', 'lang', 'idioma'],
  finish: ['foil', 'finish', 'printing'],
  condition: ['condition', 'estado'],
  rarity: ['rarity', 'rareza', 'cardrarity'],
  notes: ['notes', 'notas'],
  zone: ['zone', 'board', 'section', 'zona'],
  imageUrl: ['imageurl'],
  altName: ['altname'],
};

const looksLikeSetCode = (v) => /^[A-Za-z0-9]{2,6}$/.test(v);

export function parseCsvEntries(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { entries: [], warnings: ['El CSV no tiene filas.'] };
  const header = rows[0].map(key);
  const col = {};
  for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
    // En "set": se prefiere el código de edición al nombre de la edición
    const idx = names.map((n) => header.indexOf(n)).find((i) => i !== -1);
    if (idx !== undefined) col[field] = idx;
  }
  // Algunos formatos tienen código y nombre de edición a la vez: se quiere el código
  const codeIdx = ['setcode', 'editioncode', 'setabbr'].map((n) => header.indexOf(n)).find((i) => i !== -1);
  if (codeIdx !== undefined) col.set = codeIdx;
  if (col.name === undefined && col.cardId === undefined && col.scryfallId === undefined) {
    return { entries: [], warnings: ['No se encontró la columna del nombre de la carta (Name).'] };
  }
  const get = (r, f) => (col[f] === undefined ? '' : String(r[col[f]] ?? '').trim());
  const entries = [];
  rows.slice(1).forEach((r) => {
    const name = get(r, 'name');
    const cardId = get(r, 'cardId');
    const scryfallId = get(r, 'scryfallId');
    if (!name && !cardId && !scryfallId) return;
    const setRaw = get(r, 'set');
    entries.push({
      quantity: clampQty(get(r, 'quantity') || 1),
      name,
      cardId,
      scryfallId,
      set: looksLikeSetCode(setRaw) ? setRaw : '',
      number: get(r, 'number'),
      language: parseLanguage(get(r, 'language')),
      finish: parseFinish(get(r, 'finish')),
      condition: parseCondition(get(r, 'condition')),
      rarity: get(r, 'rarity'),
      notes: get(r, 'notes'),
      zone: normZone(get(r, 'zone')),
    });
  });
  return { entries, warnings: [] };
}

// ---------------------------------------------------------------- zonas
export function normZone(value) {
  const v = norm(value);
  if (!v) return '';
  if (/commander|comandante/.test(v)) return 'commander';
  if (/side|sb|banquillo/.test(v)) return 'side';
  if (/extra/.test(v)) return 'extra';
  if (/egg|digitama/.test(v)) return 'digi-egg';
  if (/main|deck|mazo|maybe|library/.test(v)) return 'main';
  return '';
}

// ---------------------------------------------------------------- texto
const DIGIMON_ID = /\b((?:BT|EX|ST|RB|LM|P|AD|BO|DM|CS)\d{0,2}-\d{2,3}(?:_P\d+)?)\b/i;

// Una línea de lista: "4 Nombre (SET) 123", "4x Nombre", "Nombre x4", "4 Agumon BT1-010", "BT1-010 x4"
export function parseTextLine(line, gameKey) {
  let s = line.trim().replace(/^SB:\s*/i, '');
  if (!s || /^(\/\/|#)/.test(s)) return null;
  let quantity = 1;
  let m = /^(\d+)\s*[xX×]?\s+(.*)$/.exec(s);
  if (m) {
    quantity = clampQty(m[1]);
    s = m[2];
  } else if ((m = /^(.*?)\s+[xX×]\s*(\d+)$/.exec(s))) {
    quantity = clampQty(m[2]);
    s = m[1];
  } else if ((m = /^(.*?)\s*[xX×]\s*(\d+)\s*$/.exec(s)) && gameKey === 'digimon') {
    quantity = clampQty(m[2]);
    s = m[1];
  }
  const entry = { quantity, name: '', set: '', number: '', cardId: '' };
  if (gameKey === 'digimon') {
    const id = DIGIMON_ID.exec(s);
    if (id) {
      entry.cardId = id[1].toUpperCase().replace(/_P(\d+)/, '_P$1');
      s = s.replace(id[0], '').replace(/[()\[\]]/g, ' ');
    }
    entry.name = s.replace(/\s+/g, ' ').trim();
    return entry.name || entry.cardId ? entry : null;
  }
  if (gameKey === 'mtg') {
    // "Nombre (SET) 123" y variantes con *F* (foil)
    if (/\s\*[FE]\*\s*$/i.test(s)) {
      entry.finish = /\*E\*/i.test(s) ? 'etched' : 'foil';
      s = s.replace(/\s\*[FE]\*\s*$/i, '');
    }
    const set = /^(.*?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★\-]+))?\s*$/.exec(s);
    if (set) {
      entry.name = set[1].trim();
      entry.set = set[2];
      entry.number = set[3] || '';
      return entry;
    }
  }
  entry.name = s.trim();
  return entry.name ? entry : null;
}

// Texto con secciones ("Deck", "Sideboard", "Commander", "Extra Deck"...). Una línea en blanco entre bloques
// también puede separar el mazo del sideboard (formato de MTG Arena / MTGO).
export function parseTextList(text, gameKey) {
  const entries = [];
  let zone = '';
  let sawHeader = false;
  let blankRun = false;
  let blocks = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (entries.length) blankRun = true;
      continue;
    }
    const header = /^[A-Za-zÀ-ÿ\- ]+:?$/.test(line) && !/^\d/.test(line) ? normZone(line.replace(/:$/, '')) : '';
    if (header && !/^\d/.test(line)) {
      zone = header;
      sawHeader = true;
      blankRun = false;
      continue;
    }
    if (blankRun && !sawHeader && gameKey === 'mtg') {
      blocks += 1;
      zone = blocks === 1 ? 'side' : zone; // segundo bloque sin cabecera = sideboard
    }
    blankRun = false;
    const entry = parseTextLine(raw, gameKey);
    if (!entry) continue;
    if (/^SB:/i.test(line)) entry.zone = 'side';
    else if (zone) entry.zone = zone;
    entries.push(entry);
  }
  return entries;
}

// ---------------------------------------------------------------- YDK / YDKE (Yu-Gi-Oh!)
export function parseYdk(text) {
  const entries = [];
  let zone = 'main';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#main/i.test(line)) zone = 'main';
    else if (/^#extra/i.test(line)) zone = 'extra';
    else if (/^!side/i.test(line)) zone = 'side';
    else if (/^\d+$/.test(line)) entries.push({ quantity: 1, name: '', cardId: String(parseInt(line, 10)), zone });
  }
  return collapseEntries(entries);
}

export function formatYdk(deck) {
  const ids = (zone) => deck.cards.filter((c) => c.zone === zone).flatMap((c) => Array(c.quantity).fill(c.baseId || c.cardId));
  return ['#created by TCG Manager', '#main', ...ids('main'), '#extra', ...ids('extra'), '!side', ...ids('side'), ''].join('\n');
}

const b64encode = (ids) => {
  const bytes = new Uint8Array(ids.length * 4);
  const view = new DataView(bytes.buffer);
  ids.forEach((id, i) => view.setUint32(i * 4, Number(id) >>> 0, true));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
const b64decode = (text) => {
  const bin = atob(text);
  const view = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
  const ids = [];
  for (let i = 0; i + 4 <= bin.length; i += 4) ids.push(view.getUint32(i, true));
  return ids;
};

export function parseYdke(text) {
  const m = /ydke:\/\/([^!]*)!([^!]*)!([^!]*)!/i.exec(String(text).trim());
  if (!m) return [];
  const zones = ['main', 'extra', 'side'];
  const entries = [];
  [m[1], m[2], m[3]].forEach((part, i) => {
    b64decode(part).forEach((id) => entries.push({ quantity: 1, name: '', cardId: String(id), zone: zones[i] }));
  });
  return collapseEntries(entries);
}

export function formatYdke(deck) {
  const ids = (zone) => deck.cards.filter((c) => c.zone === zone).flatMap((c) => Array(c.quantity).fill(c.baseId || c.cardId));
  return `ydke://${b64encode(ids('main'))}!${b64encode(ids('extra'))}!${b64encode(ids('side'))}!`;
}

// Junta entradas repetidas (misma carta y zona) sumando cantidades
export function collapseEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = [e.cardId, e.scryfallId, norm(e.name), e.set, e.number, e.zone, e.language, e.finish, e.condition].join('|');
    const prev = map.get(k);
    if (prev) prev.quantity = Math.min(999, prev.quantity + e.quantity);
    else map.set(k, { ...e });
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- JSON propio
const COLLECTION_JSON = 'tcg-manager-collection';
const DECK_JSON = 'tcg-manager-deck';
const CARD_FIELDS = ['cardId', 'name', 'altName', 'imageUrl', 'imageBack', 'backKind', 'setCode', 'number', 'rarity', 'language', 'condition', 'finish', 'quantity', 'notes', 'facets', 'zone'];

const pickCard = (c) => Object.fromEntries(CARD_FIELDS.filter((f) => c[f] !== undefined && c[f] !== '' && c[f] !== null).map((f) => [f, c[f]]));

// ---------------------------------------------------------------- listas de formatos
export const COLLECTION_FORMATS = {
  mtg: [
    { id: 'moxfield', label: 'Moxfield (CSV)', ext: 'csv', mime: 'text/csv' },
    { id: 'manabox', label: 'ManaBox (CSV)', ext: 'csv', mime: 'text/csv' },
    { id: 'archidekt', label: 'Archidekt (CSV)', ext: 'csv', mime: 'text/csv' },
    { id: 'deckbox', label: 'Deckbox (CSV)', ext: 'csv', mime: 'text/csv' },
    { id: 'text', label: 'Lista de texto (4 Nombre (SET) 123)', ext: 'txt', mime: 'text/plain' },
    { id: 'csv', label: 'CSV de TCG Manager', ext: 'csv', mime: 'text/csv' },
    { id: 'json', label: 'JSON de TCG Manager (copia completa)', ext: 'json', mime: 'application/json' },
  ],
  ygo: [
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
    { id: 'text', label: 'Lista de texto (3 Nombre)', ext: 'txt', mime: 'text/plain' },
    { id: 'json', label: 'JSON de TCG Manager (copia completa)', ext: 'json', mime: 'application/json' },
  ],
  digimon: [
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
    { id: 'text', label: 'Lista de texto (4 Nombre BT1-010)', ext: 'txt', mime: 'text/plain' },
    { id: 'json', label: 'JSON de TCG Manager (copia completa)', ext: 'json', mime: 'application/json' },
  ],
};

export const DECK_FORMATS = {
  mtg: [
    { id: 'text', label: 'Texto (MTG Arena / MTGO / Moxfield)', ext: 'txt', mime: 'text/plain' },
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
    { id: 'json', label: 'JSON de TCG Manager', ext: 'json', mime: 'application/json' },
  ],
  ygo: [
    { id: 'ydk', label: 'YDK (EDOPro, YGOPro, Master Duel Meta…)', ext: 'ydk', mime: 'text/plain' },
    { id: 'ydke', label: 'Enlace ydke://', ext: 'txt', mime: 'text/plain' },
    { id: 'text', label: 'Texto (3 Nombre)', ext: 'txt', mime: 'text/plain' },
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
    { id: 'json', label: 'JSON de TCG Manager', ext: 'json', mime: 'application/json' },
  ],
  digimon: [
    { id: 'text', label: 'Texto (4 Nombre BT1-010)', ext: 'txt', mime: 'text/plain' },
    { id: 'ids', label: 'Lista de números (uno por copia, JSON)', ext: 'json', mime: 'application/json' },
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
    { id: 'json', label: 'JSON de TCG Manager', ext: 'json', mime: 'application/json' },
  ],
};

const exportName = (c) => c.altName || c.name; // los nombres en inglés son los que entienden las demás webs
const safeFile = (s) => String(s || 'tcg').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'tcg';
const sortByName = (cards) => [...cards].sort((a, b) => exportName(a).localeCompare(exportName(b)));

const ZONE_TITLES = {
  mtg: { commander: 'Commander', main: 'Deck', side: 'Sideboard' },
  ygo: { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' },
  digimon: { 'digi-egg': 'Digi-Egg Deck', main: 'Main Deck' },
};

function textLine(gameKey, c) {
  const name = exportName(c);
  if (gameKey === 'mtg') {
    const set = c.setCode ? ` (${String(c.setCode).toUpperCase()})${c.number ? ` ${c.number}` : ''}` : '';
    return `${c.quantity} ${name}${set}${c.finish === 'foil' ? ' *F*' : c.finish === 'etched' ? ' *E*' : ''}`;
  }
  if (gameKey === 'digimon') return `${c.quantity} ${name} ${c.cardId}`.replace(/\s+/g, ' ');
  return `${c.quantity} ${name}`;
}

// ---------------------------------------------------------------- exportar colección
export function exportCollection(format, gameKey, cards, { name = '' } = {}) {
  const fmt = (COLLECTION_FORMATS[gameKey] || []).find((f) => f.id === format);
  if (!fmt) throw new Error('Formato no disponible para este juego');
  const sorted = sortByName(cards);
  const file = `coleccion-${gameKey}-${new Date().toISOString().slice(0, 10)}.${fmt.ext}`;
  const finishWord = (c) => (c.finish === 'foil' ? 'foil' : c.finish === 'etched' ? 'etched' : '');
  let text;
  if (format === 'json') {
    text = JSON.stringify({ format: COLLECTION_JSON, version: 1, game: gameKey, exportedAt: new Date().toISOString(), cards: sorted.map(pickCard) }, null, 2);
  } else if (format === 'text') {
    text = sorted.map((c) => textLine(gameKey, c)).join('\n') + '\n';
  } else if (format === 'moxfield') {
    text = toCsv([['Count', 'Name', 'Edition', 'Condition', 'Language', 'Foil', 'Collector Number'],
      ...sorted.map((c) => [c.quantity, exportName(c), (c.setCode || '').toLowerCase(), CONDITION_EXPORT[c.condition] || 'Near Mint', LANG_EXPORT[c.language] || 'English', finishWord(c), c.number || ''])]);
  } else if (format === 'manabox') {
    text = toCsv([['Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity', 'Quantity', 'ManaBox ID', 'Scryfall ID', 'Purchase price', 'Misprint', 'Altered', 'Condition', 'Language', 'Purchase price currency'],
      ...sorted.map((c) => [exportName(c), (c.setCode || '').toLowerCase(), '', c.number || '', c.finish === 'foil' ? 'foil' : c.finish === 'etched' ? 'etched' : 'normal', c.rarity || '', c.quantity, '', c.cardId, '', 'false', 'false',
        { M: 'near_mint', NM: 'near_mint', EX: 'near_mint', GD: 'lightly_played', LP: 'lightly_played', PL: 'moderately_played', PO: 'heavily_played' }[c.condition] || 'near_mint', c.language || 'en', 'EUR'])]);
  } else if (format === 'archidekt') {
    text = toCsv([['Quantity', 'Name', 'Finish', 'Condition', 'Date Added', 'Language', 'Purchase Price', 'Tags', 'Edition Name', 'Edition Code', 'Multiverse Id', 'Scryfall ID', 'MTGO ID', 'Collector Number'],
      ...sorted.map((c) => [c.quantity, exportName(c), c.finish === 'foil' ? 'Foil' : c.finish === 'etched' ? 'Etched' : 'Normal', { M: 'NM', NM: 'NM', EX: 'NM', GD: 'LP', LP: 'LP', PL: 'MP', PO: 'HP' }[c.condition] || 'NM',
        c.acquiredAt ? String(c.acquiredAt).slice(0, 10) : '', LANG_EXPORT[c.language] || 'English', '', '', '', (c.setCode || '').toLowerCase(), '', c.cardId, '', c.number || ''])]);
  } else if (format === 'deckbox') {
    text = toCsv([['Count', 'Tradelist Count', 'Name', 'Edition', 'Card Number', 'Condition', 'Language', 'Foil', 'Signed', 'Artist Proof', 'Altered Art', 'Misprint', 'Promo', 'Textless', 'My Price'],
      ...sorted.map((c) => [c.quantity, 0, exportName(c), (c.setCode || '').toUpperCase(), c.number || '', { M: 'Mint', NM: 'Near Mint', EX: 'Good (Lightly Played)', GD: 'Good (Lightly Played)', LP: 'Good (Lightly Played)', PL: 'Played', PO: 'Heavily Played' }[c.condition] || 'Near Mint', LANG_EXPORT[c.language] || 'English', finishWord(c) ? 'foil' : '', '', '', '', '', '', '', ''])]);
  } else {
    // CSV genérico de TCG Manager (sirve para los tres juegos)
    text = toCsv([['Quantity', 'Name', 'Card ID', 'Set', 'Collector Number', 'Rarity', 'Language', 'Condition', 'Finish', 'Notes'],
      ...sorted.map((c) => [c.quantity, exportName(c), c.cardId, c.setCode || '', c.number || '', c.rarity || '', c.language || 'en', c.condition || 'NM', c.finish || 'normal', c.notes || ''])]);
  }
  return { filename: file, mime: fmt.mime, text, count: cards.length, title: name };
}

// ---------------------------------------------------------------- exportar mazo
export function exportDeck(format, gameKey, deck) {
  const fmt = (DECK_FORMATS[gameKey] || []).find((f) => f.id === format);
  if (!fmt) throw new Error('Formato no disponible para este juego');
  const zones = (ZONE_TITLES[gameKey] && Object.keys(ZONE_TITLES[gameKey])) || ['main'];
  const cards = deck.cards || [];
  const base = safeFile(deck.name);
  const filename = `${base}.${fmt.ext}`;
  let text;
  if (format === 'json') {
    text = JSON.stringify({ format: DECK_JSON, version: 1, game: gameKey, name: deck.name, deckFormat: deck.format, description: deck.description || '', exportedAt: new Date().toISOString(), cards: cards.map(pickCard) }, null, 2);
  } else if (format === 'ydk') text = formatYdk({ cards });
  else if (format === 'ydke') text = formatYdke({ cards });
  else if (format === 'ids') {
    text = JSON.stringify(cards.filter((c) => c.zone !== 'digi-egg').concat(cards.filter((c) => c.zone === 'digi-egg')).flatMap((c) => Array(c.quantity).fill(c.cardId)), null, 0);
  } else if (format === 'csv') {
    text = toCsv([['Quantity', 'Name', 'Card ID', 'Set', 'Collector Number', 'Zone'],
      ...zones.flatMap((z) => sortByName(cards.filter((c) => c.zone === z)).map((c) => [c.quantity, exportName(c), c.cardId, c.setCode || '', c.number || '', z]))]);
  } else {
    const blocks = zones.map((z) => {
      const inZone = sortByName(cards.filter((c) => c.zone === z));
      return inZone.length ? [ZONE_TITLES[gameKey][z], ...inZone.map((c) => textLine(gameKey, c))].join('\n') : '';
    }).filter(Boolean);
    text = blocks.join('\n\n') + '\n';
  }
  return { filename, mime: fmt.mime, text, count: cards.reduce((s, c) => s + c.quantity, 0) };
}

// ---------------------------------------------------------------- importar (detecta el formato)
function tryJson(text) {
  const t = String(text).trim();
  if (!/^[{[]/.test(t)) return null;
  try {
    return JSON.parse(t);
  } catch (err) {
    return null;
  }
}

function entriesFromNative(cards) {
  return (Array.isArray(cards) ? cards : []).filter((c) => c && c.cardId && c.name).map((c) => ({
    quantity: clampQty(c.quantity), name: String(c.name), cardId: String(c.cardId), zone: c.zone || '', full: c,
  }));
}

// Devuelve { kind: 'collection'|'deck', format, entries, name?, deckFormat?, description?, game?, warnings }
export function parseImport(text, gameKey, kind) {
  const src = String(text || '').trim();
  const warnings = [];
  if (!src) return { entries: [], format: '', warnings: ['No hay nada que importar.'] };

  const json = tryJson(src);
  if (json) {
    if (json.format === COLLECTION_JSON || json.format === DECK_JSON) {
      if (json.game && json.game !== gameKey) return { entries: [], format: 'json', warnings: [`El archivo es de otro juego (${json.game}).`] };
      if ((json.format === DECK_JSON) !== (kind === 'deck')) return { entries: [], format: 'json', warnings: [kind === 'deck' ? 'El archivo es una colección, no un mazo.' : 'El archivo es un mazo, no una colección.'] };
      return { format: 'json', entries: entriesFromNative(json.cards), name: json.name, deckFormat: json.deckFormat, description: json.description, warnings };
    }
    // Lista de números (una por copia): ["BT1-010", "BT1-010", ...]
    if (Array.isArray(json) && json.every((x) => typeof x === 'string')) {
      const entries = collapseEntries(json.map((x) => x.trim()).filter((x) => DIGIMON_ID.test(x)).map((x) => ({ quantity: 1, name: '', cardId: DIGIMON_ID.exec(x)[1].toUpperCase() })));
      return { format: 'ids', entries, warnings: entries.length ? warnings : ['La lista no contiene números de carta reconocibles.'] };
    }
    return { entries: [], format: 'json', warnings: ['El JSON no tiene un formato reconocido.'] };
  }

  if (/ydke:\/\//i.test(src)) return { format: 'ydke', entries: parseYdke(src), warnings };
  if (/^#main/im.test(src) || /^#created by/im.test(src)) return { format: 'ydk', entries: parseYdk(src), warnings };

  // CSV: la primera línea parece una cabecera con delimitadores
  const first = src.split(/\r?\n/, 1)[0];
  if (/[,;\t]/.test(first) && /\b(name|card ?name|nombre|count|quantity|qty)\b/i.test(first)) {
    const res = parseCsvEntries(src);
    return { format: 'csv', entries: res.entries, warnings: [...warnings, ...res.warnings] };
  }

  const entries = collapseEntries(parseTextList(src, gameKey));
  if (!entries.length) warnings.push('No se reconoció ninguna carta. Cada línea debería ser, por ejemplo, "3 Nombre de la carta".');
  return { format: 'text', entries, warnings };
}
