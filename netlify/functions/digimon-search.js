// Plan B para la búsqueda de Digimon: si el navegador no puede llamar directamente a
// digimoncard.io (CORS, bloqueadores de contenido...), esta función hace la misma
// consulta desde el servidor. Solo para usuarios con sesión.
// Documentación de la API: https://digimoncard.io/api-documentation
// (15 peticiones cada 10 s por IP; sin resultados responde 400 con { error }).
const { getUserFromRequest } = require('./_lib/auth');
const { json } = require('./_lib/http');

const BASE = 'https://digimoncard.io/api-public';
const MAX_RESULTS = 600;

// Parámetros que se reenvían a la API (lista cerrada: nada más pasa)
const TEXT_PARAMS = ['n', 'desc', 'color', 'type', 'attribute', 'digitype', 'evocolor', 'stage', 'pack', 'card', 'artist'];
const NUMBER_PARAMS = ['level', 'playcost', 'evocost', 'dp'];

function buildParams(q) {
  const params = new URLSearchParams({ series: 'Digimon Card Game', sort: 'name', sortdirection: 'asc', limit: String(MAX_RESULTS) });
  let criteria = 0;
  for (const key of TEXT_PARAMS) {
    const value = String(q[key] || '').trim().slice(0, 80);
    if (value) {
      params.set(key, value);
      criteria++;
    }
  }
  for (const key of NUMBER_PARAMS) {
    const value = String(q[key] || '').trim();
    if (/^\d{1,6}$/.test(value)) {
      params.set(key, value);
      criteria++;
    }
  }
  return { params, criteria };
}

// Se queda con los campos que usa la web (la API devuelve también los textos de efecto)
function slim(c) {
  return {
    name: c.name,
    id: c.id || c.cardnumber,
    type: c.type,
    level: c.level,
    play_cost: c.play_cost,
    evolution_cost: c.evolution_cost,
    color: c.color,
    color2: c.color2,
    dp: c.dp,
    rarity: c.rarity,
    set_name: c.set_name,
    image_url: c.image_url,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  if (!getUserFromRequest(event)) return json(401, { error: 'No autorizado' });

  const { params, criteria } = buildParams(event.queryStringParameters || {});
  // Sin ningún criterio la API responde con un error
  if (criteria === 0) return json(200, { cards: [] });

  try {
    const res = await fetch(`${BASE}/search?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    // Sin resultados: la API responde 400 con { error } (o 404)
    if (res.status === 400 || res.status === 404) return json(200, { cards: [] });
    if (res.status === 429) return json(429, { error: 'Demasiadas búsquedas seguidas en Digimon. Espera unos segundos e inténtalo de nuevo' });
    if (!res.ok) return json(502, { error: 'El catálogo de Digimon no está disponible ahora mismo' });

    const data = await res.json();
    const cards = Array.isArray(data) ? data.slice(0, MAX_RESULTS).map(slim) : [];
    return json(200, { cards }, { 'Cache-Control': 'private, max-age=300', Vary: 'Cookie' });
  } catch (err) {
    console.error('digimon-search:', err.message);
    return json(502, { error: 'El catálogo de Digimon no está disponible ahora mismo' });
  }
};
