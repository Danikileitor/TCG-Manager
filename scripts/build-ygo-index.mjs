#!/usr/bin/env node
// Genera el índice de búsqueda de Yu-Gi-Oh! a partir de YGOJSON
// (https://github.com/iconmaster5326/YGOJSON), un archivo pequeño por idioma:
//
//   public/data/ygo/<idioma>.json   (es, en, fr, de, it, pt, ja, ko, zhs, zht)
//   public/data/ygo/details.json    (datos para los filtros: atributo, tipo, nivel, ATK/DEF...)
//   public/data/ygo/sets.json       (lista de sets) y cardsets.json (en qué sets está cada carta)
//   public/data/ygo/arts.json       (artes alternativos de cada carta)
//   public/data/ygo/meta.json
//
// YGOJSON no es una API de búsqueda: son miles de cartas en archivos JSON (el agregado
// pesa ~110 MB). Por eso se prepara aquí un índice mínimo (id, nombre oficial en ese
// idioma, nombre en inglés, tipo e imagen) que el navegador descarga solo para el idioma
// elegido. Los nombres son los OFICIALES de YGOJSON; no se traduce nada.
//
// Uso (Node 18 o superior, sin dependencias):
//   node scripts/build-ygo-index.mjs                 # descarga la última versión de GitHub
//   node scripts/build-ygo-index.mjs --zip ruta.zip  # usa un aggregate.zip ya descargado
//
// Después, sube los archivos generados a GitHub (carpeta public/data/ygo).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ZIP_URL = 'https://github.com/iconmaster5326/YGOJSON/releases/download/v1/aggregate.zip';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'ygo');

// Códigos de idioma de YGOJSON -> códigos que usa esta web
const LANGS = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  ja: 'ja',
  ko: 'ko',
  'zh-CN': 'zhs',
  'zh-TW': 'zht',
};

// Monstruos que van al Extra Deck
const EXTRA_TYPES = ['fusion', 'synchro', 'xyz', 'link'];
// No se incluyen: fichas (tokens) y cartas Skill (no van en ningún mazo normal)
const EXCLUDED = ['token', 'skill'];

// ---------- Lectura mínima de un .zip (sin dependencias) ----------
function readZipEntry(buf, wanted) {
  // Fin del directorio central
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo no parece un .zip válido');

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central del .zip corrupto');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (name === wanted) {
      if (compSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('.zip64 no soportado');
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Método de compresión no soportado: ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`No se encontró ${wanted} dentro del .zip`);
}

// ---------- Construcción del índice ----------
const DEFAULT_IMG = (passcode) => `https://images.ygoprodeck.com/images/cards/${passcode}.jpg`;

function kindOf(card) {
  if (card.cardType === 'spell') return 's';
  if (card.cardType === 'trap') return 't';
  const types = card.monsterCardTypes || [];
  return types.some((t) => EXTRA_TYPES.includes(t)) ? 'x' : 'm';
}

async function main() {
  const zipArg = process.argv.indexOf('--zip');
  let zip;
  if (zipArg > -1) {
    zip = readFileSync(process.argv[zipArg + 1]);
    console.log('Usando .zip local:', process.argv[zipArg + 1]);
  } else {
    console.log('Descargando', ZIP_URL, '(~35 MB)...');
    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error(`No se pudo descargar YGOJSON (HTTP ${res.status})`);
    zip = Buffer.from(await res.arrayBuffer());
  }

  console.log('Leyendo cards.json...');
  const cards = JSON.parse(readZipEntry(zip, 'cards.json').toString('utf8'));
  let sourceMeta = {};
  try {
    sourceMeta = JSON.parse(readZipEntry(zip, 'meta.json').toString('utf8'));
  } catch (err) {
    // meta.json es opcional
  }

  const usable = cards.filter((c) => !EXCLUDED.includes(c.cardType));
  const byLang = Object.fromEntries(Object.values(LANGS).map((l) => [l, []]));
  const details = {}; // cardId -> datos para filtrar
  const arts = {}; // cardId -> artes alternativos
  const cardSetUuids = {}; // cardId -> uuids de sets

  for (const card of usable) {
    // El passcode sin ceros a la izquierda coincide con el id de YGOPRODeck usado hasta ahora
    // (así las cartas ya guardadas en colecciones y mazos siguen siendo las mismas)
    const rawPasscode = (card.passwords || [])[0] || '';
    const passcode = /^\d+$/.test(rawPasscode) ? String(parseInt(rawPasscode, 10)) : rawPasscode;
    const cardId = passcode || card.id;
    const enName = card.text.en && card.text.en.name;
    // Imagen principal: la del passcode de la carta (si no, la primera)
    const images = card.images || [];
    const mainInfo =
      images.find((i) => rawPasscode && (i.password === rawPasscode || (i.card || '').endsWith(`/${rawPasscode}.jpg`))) || images[0];
    const image = mainInfo && mainInfo.card;
    // Solo se guarda la URL de la imagen cuando no sigue el patrón por defecto
    const img = !image || (passcode && image === DEFAULT_IMG(passcode)) ? '' : image;
    const kind = kindOf(card);

    // Datos para los filtros (no dependen del idioma)
    const tags = [...new Set([...(card.classifications || []), ...(card.monsterCardTypes || [])])];
    const level = card.level ?? card.rank ?? ((card.linkArrows || []).length || null);
    details[cardId] = [
      card.attribute || '',
      card.type || '',
      level,
      card.atk ?? null,
      card.def ?? null,
      tags.join(','),
      card.subcategory || '',
      card.scale ?? null,
    ];

    // Artes alternativos: el resto de imágenes de la carta (la primera es la principal)
    const extra = [];
    for (const imageInfo of images) {
      if (imageInfo === mainInfo) continue;
      const art = imageInfo.card;
      if (!art || art === image) continue;
      // Algunas imágenes no traen passcode: se deduce del nombre del archivo, o se usa su uuid
      const fromUrl = /\/cards\/(\d+)\.jpg$/.exec(art);
      const rawId = imageInfo.password || (fromUrl && fromUrl[1]) || imageInfo.id;
      const artId = /^\d+$/.test(rawId) ? String(parseInt(rawId, 10)) : rawId;
      if (artId === cardId) continue;
      extra.push(fromUrl && String(parseInt(fromUrl[1], 10)) === artId ? artId : [artId, art]);
    }
    if (extra.length) arts[cardId] = extra;
    cardSetUuids[cardId] = [...new Set(card.sets || [])];

    for (const [srcLang, lang] of Object.entries(LANGS)) {
      const name = card.text[srcLang] && card.text[srcLang].name;
      if (!name) continue; // sin nombre oficial en este idioma: no aparece en él
      const alt = lang !== 'en' && enName && enName !== name ? enName : '';
      byLang[lang].push([cardId, name, alt, kind, img]);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const counts = {};
  for (const [lang, rows] of Object.entries(byLang)) {
    rows.sort((a, b) => a[1].localeCompare(b[1], lang === 'zhs' || lang === 'zht' ? 'zh' : lang));
    writeFileSync(join(OUT_DIR, `${lang}.json`), JSON.stringify(rows));
    counts[lang] = rows.length;
  }
  writeFileSync(join(OUT_DIR, 'details.json'), JSON.stringify(details));
  writeFileSync(join(OUT_DIR, 'arts.json'), JSON.stringify(arts));

  // Sets: se guardan solo los que tienen cartas y se enlazan por posición
  let sets = [];
  try {
    sets = JSON.parse(readZipEntry(zip, 'sets.json').toString('utf8'));
  } catch (err) {
    console.warn('Aviso: no se pudo leer sets.json, el filtro de sets no estará disponible');
  }
  const setList = [];
  const setIndex = new Map();
  for (const set of sets) {
    const locales = Object.values(set.locales || {});
    const en = (set.locales || {}).en;
    const prefix = String((en && en.prefix) || (locales[0] && locales[0].prefix) || '');
    const code = prefix.replace(/-[A-Z]{1,3}\d*$/, '');
    const name = (set.name && (set.name.en || Object.values(set.name)[0])) || code;
    if (name) setIndex.set(set.id, { code, name });
  }
  const used = new Map();
  const cardSets = {};
  for (const [cardId, uuids] of Object.entries(cardSetUuids)) {
    const list = [];
    for (const uuid of uuids) {
      if (!setIndex.has(uuid)) continue;
      if (!used.has(uuid)) {
        used.set(uuid, setList.length);
        setList.push(setIndex.get(uuid));
      }
      list.push(used.get(uuid));
    }
    if (list.length) cardSets[cardId] = list;
  }
  // Ordenados por nombre; hay que reasignar posiciones
  const order = setList.map((s, i) => i).sort((a, b) => setList[a].name.localeCompare(setList[b].name, 'en'));
  const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  writeFileSync(join(OUT_DIR, 'sets.json'), JSON.stringify(order.map((i) => [setList[i].code, setList[i].name])));
  for (const id of Object.keys(cardSets)) cardSets[id] = cardSets[id].map((i) => remap.get(i));
  writeFileSync(join(OUT_DIR, 'cardsets.json'), JSON.stringify(cardSets));

  writeFileSync(
    join(OUT_DIR, 'meta.json'),
    JSON.stringify({
      source: 'https://github.com/iconmaster5326/YGOJSON',
      generatedAt: new Date().toISOString(),
      sourceLastYGOProDeckRead: sourceMeta.lastYGOProDeckRead || null,
      sourceLastYugipediaRead: sourceMeta.lastYugipediaRead || null,
      cards: usable.length,
      sets: setList.length,
      cardsWithAlternateArt: Object.keys(arts).length,
      perLanguage: counts,
    })
  );
  console.log('Cartas incluidas:', usable.length, '(sin fichas ni Skills)');
  console.log('Por idioma:', counts);
  console.log('Índices escritos en', OUT_DIR);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
