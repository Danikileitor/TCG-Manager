// Listas de prohibidas y limitadas (y formato C / U de Digimon).
//   statusFor(gameKey, format, card) -> null | { limit: 0|1|2|3, reason }   (limit 0 = prohibida)
//
// Fuentes (siempre actuales, sin tocar el código cuando las listas cambian):
//   MTG:       el campo `legalities` que Scryfall devuelve con cada carta (banned -> 0, restricted -> 1).
//   Yu-Gi-Oh!: /api/banlists (la función lee YGOPRODeck; caché de 12 h en el CDN).
//   Digimon:   /api/banlists (la función lee la página oficial de cartas restringidas).
// El navegador guarda la respuesta 24 h en localStorage. Si /api/banlists falla se usa la copia
// /data/banlists.json, y si tampoco hay nada, simplemente no se marcan cartas (nunca bloquea el editor).
import { el } from './ui.js';

const STORE_KEY = 'tcg.banlists.v1';
const TTL_MS = 24 * 3600 * 1000;
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Formatos de Digimon con restricción de rareza: solo comunes e infrecuentes
const DIGIMON_CU = new Set(['c-u']);
const isCommon = (r) => /^(c|common)$/i.test(String(r || '').trim());
const isUncommon = (r) => /^(u|uncommon)$/i.test(String(r || '').trim());

let lists = null; // { ygo: {tcg: {nombre: límite}}, digimon: { banned:Set, limited:Set, pairs:[] } }
let loading = null;
const mtgLegal = new Map(); // nombre en inglés normalizado -> legalities de Scryfall

function build(raw) {
  const d = (raw && raw.digimon) || {};
  return {
    updated: raw && raw.updated,
    ygo: (raw && raw.ygo && raw.ygo.tcg) || {},
    digimon: { banned: new Set(d.banned || []), limited: new Set(d.limited || []), pairs: d.pairs || [] },
  };
}

function readStore() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    return v && v.raw ? v : null;
  } catch (err) {
    return null;
  }
}

export function loadBanlists() {
  if (lists) return Promise.resolve(lists);
  if (loading) return loading;
  loading = (async () => {
    const stored = readStore();
    if (stored && Date.now() - stored.at < TTL_MS) return (lists = build(stored.raw));
    for (const url of ['/api/banlists', '/data/banlists.json']) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const raw = await res.json();
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), raw }));
        } catch (err) {
          // sin almacenamiento: no pasa nada
        }
        return (lists = build(raw));
      } catch (err) {
        // se prueba la siguiente fuente
      }
    }
    return (lists = build(stored && stored.raw)); // lista antigua si la hay; si no, vacía
  })();
  return loading;
}

// ---------- MTG: legalidad por carta (Scryfall) ----------
// Las cartas que vienen del buscador de Scryfall ya traen `legalities`; las de la colección o de un mazo guardado no.
export async function ensureLegalities(cards) {
  const need = [...new Set(cards.filter((c) => !c.legalities && c.name).map((c) => c.altName || c.name))].filter((n) => !mtgLegal.has(norm(n)));
  for (let i = 0; i < need.length; i += 75) {
    const chunk = need.slice(i, i + 75);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.data || []).forEach((c) => mtgLegal.set(norm(c.name), c.legalities || {}));
    } catch (err) {
      // sin red: no se marcan
    }
  }
}

const baseId = (id) => String(id || '').replace(/_P\d+$/i, '').toUpperCase();

export function statusFor(gameKey, format, card) {
  if (!card) return null;
  if (gameKey === 'mtg') {
    const legal = card.legalities || mtgLegal.get(norm(card.altName || card.name));
    const v = legal && legal[format];
    if (v === 'banned') return { limit: 0, reason: 'Prohibida' };
    if (v === 'restricted') return { limit: 1, reason: 'Restringida a 1 copia' };
    return null;
  }
  if (!lists) return null;
  if (gameKey === 'ygo') {
    if (format !== 'advanced') return null; // Traditional y Speed Duel tienen listas propias sin fuente automática
    const limit = lists.ygo[norm(card.altName || card.name)];
    if (limit === undefined) return null;
    return { limit, reason: limit === 0 ? 'Prohibida' : `Limitada a ${limit}` };
  }
  if (gameKey === 'digimon') {
    const id = baseId(card.cardId);
    if (DIGIMON_CU.has(format) && card.rarity && !isCommon(card.rarity) && !isUncommon(card.rarity)) {
      return { limit: 0, reason: 'Solo se admiten cartas comunes (C) e infrecuentes (U)' };
    }
    if (lists.digimon.banned.has(id)) return { limit: 0, reason: 'Prohibida' };
    if (lists.digimon.limited.has(id)) return { limit: 1, reason: 'Restringida a 1 copia' };
  }
  return null;
}

// Parejas prohibidas de Digimon presentes en el mazo: ["EX2-007 + EX7-064", ...]
export function bannedPairsIn(gameKey, cards) {
  if (gameKey !== 'digimon' || !lists) return [];
  const have = new Map(cards.map((c) => [baseId(c.cardId), c.name]));
  return lists.digimon.pairs.filter(([a, b]) => have.has(a) && have.has(b)).map(([a, b]) => `${have.get(a)} (${a}) + ${have.get(b)} (${b})`);
}

// Insignia para la esquina superior derecha de la imagen: ⃠ rojo (prohibida) o número amarillo en círculo rojo
const SVG_NS = 'http://www.w3.org/2000/svg';
export function banBadge(status) {
  if (!status) return null;
  if (status.limit === 0) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const circle = document.createElementNS(SVG_NS, 'circle');
    const bar = document.createElementNS(SVG_NS, 'line');
    for (const [k, v] of Object.entries({ cx: 12, cy: 12, r: 9.5, fill: 'rgba(255,255,255,.85)', stroke: '#e11d24', 'stroke-width': 3 })) circle.setAttribute(k, v);
    for (const [k, v] of Object.entries({ x1: 5.3, y1: 18.7, x2: 18.7, y2: 5.3, stroke: '#e11d24', 'stroke-width': 3, 'stroke-linecap': 'round' })) bar.setAttribute(k, v);
    svg.append(circle, bar);
    return el('span', { class: 'ban-badge ban-banned', title: status.reason, role: 'img', 'aria-label': status.reason }, svg);
  }
  return el('span', { class: 'ban-badge ban-limit', title: status.reason, role: 'img', 'aria-label': status.reason, text: String(status.limit) });
}
