// Listas de prohibidas y limitadas, siempre al día.
//   Yu-Gi-Oh!: API de YGOPRODeck (banlist=tcg).
//   Digimon:   página oficial de cartas restringidas (https://world.digimoncard.com/rule/restriction_card).
//   MTG:       no hace falta; Scryfall incluye `legalities` en cada carta y el navegador las lee al buscar.
// La respuesta se cachea en el CDN de Netlify (12 h) y en el navegador. Si una fuente falla o devuelve algo
// sospechoso (p. ej. la página cambió de formato), se usa la copia incluida en public/data/banlists.json.
// Pública (son datos abiertos, sin sesión).
const fs = require('fs');
const path = require('path');
const { json } = require('./_lib/http');

const YGO_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=tcg';
const DIGIMON_URL = 'https://world.digimoncard.com/rule/restriction_card';
const MAX_AGE = 12 * 3600;

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function snapshot() {
  const candidates = [
    path.join(__dirname, '..', '..', 'public', 'data', 'banlists.json'),
    path.join(process.cwd(), 'public', 'data', 'banlists.json'),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      // siguiente ruta
    }
  }
  return null;
}

async function getText(url, as = 'text') {
  const res = await fetch(url, { headers: { 'User-Agent': 'tcg-manager', Accept: as === 'json' ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// YGOPRODeck: ban_tcg = "Banned" | "Limited" | "Semi-Limited"  ->  0 | 1 | 2
async function fetchYgo() {
  const data = await getText(YGO_URL, 'json');
  const map = {};
  for (const c of data.data || []) {
    const v = norm(c.banlist_info && c.banlist_info.ban_tcg);
    const limit = v === 'banned' ? 0 : v === 'limited' ? 1 : v === 'semi-limited' ? 2 : null;
    if (limit !== null) map[norm(c.name)] = limit;
  }
  if (Object.keys(map).length < 50) throw new Error('lista de YGO sospechosamente corta');
  return { tcg: map };
}

// Digimon: se leen los números de carta de cada apartado de la página (las cartas son imágenes /cardlist/card/<número>.png)
function numbersIn(chunk) {
  return [...new Set([...chunk.matchAll(/cardlist\/card\/([A-Za-z0-9-]+?)(?:_P\d+)?\.png/gi)].map((m) => m[1].toUpperCase()))];
}
async function fetchDigimon(base) {
  const html = await getText(DIGIMON_URL);
  const at = (re) => {
    const m = re.exec(html);
    return m ? m.index : -1;
  };
  const iBan = at(/Banned\s+cards/i);
  const iRes = at(/Restricted\s+cards/i);
  const iPair = at(/Banned\s+pairs?/i);
  if (iBan < 0 || iRes < iBan) throw new Error('formato de página desconocido');
  const banned = numbersIn(html.slice(iBan, iRes));
  const limited = numbersIn(html.slice(iRes, iPair > iRes ? iPair : undefined));
  if (banned.length < 1 || limited.length < 20) throw new Error('lista de Digimon sospechosamente corta');
  // Las parejas prohibidas cambian muy poco y su formato es irregular: se mantienen de la copia incluida
  return { banned, limited, pairs: (base && base.pairs) || [] };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  const base = snapshot() || {};
  const out = { updated: new Date().toISOString(), sources: {}, ygo: base.ygo || { tcg: {} }, digimon: base.digimon || null };
  const [ygo, digimon] = await Promise.allSettled([fetchYgo(), fetchDigimon(base.digimon)]);
  if (ygo.status === 'fulfilled') {
    out.ygo = ygo.value;
    out.sources.ygo = 'live';
  } else out.sources.ygo = `snapshot (${ygo.reason.message})`;
  if (digimon.status === 'fulfilled') {
    out.digimon = digimon.value;
    out.sources.digimon = 'live';
  } else out.sources.digimon = `snapshot (${digimon.reason.message})`;
  const res = json(200, out);
  // Solo se cachea en el CDN si al menos una fuente respondió; si no, se reintenta pronto
  const ok = Object.values(out.sources).some((s) => s === 'live');
  res.headers = { ...(res.headers || {}), 'Cache-Control': ok ? `public, max-age=3600, s-maxage=${MAX_AGE}, stale-while-revalidate=86400` : 'public, max-age=300' };
  return res;
};
