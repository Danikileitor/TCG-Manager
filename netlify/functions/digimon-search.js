// Búsqueda de cartas de Digimon. El navegador no puede llamar directamente a
// digimoncard.io (la API no permite peticiones desde otros dominios, CORS), así que la
// consulta se hace desde el servidor. Solo para usuarios con sesión.
const { getUserFromRequest } = require('./_lib/auth');
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  if (!getUserFromRequest(event)) return json(401, { error: 'No autorizado' });

  const query = String((event.queryStringParameters || {}).n || '').trim().slice(0, 80);
  if (!query) return json(200, { cards: [] });

  const url =
    'https://digimoncard.io/api-public/search.php?series=Digimon%20Card%20Game&sort=name&sortdirection=asc' +
    `&n=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    // La API responde 404 o vacío cuando no hay resultados
    if (res.status === 404) return json(200, { cards: [] });
    if (!res.ok) return json(502, { error: 'El catálogo de Digimon no está disponible ahora mismo' });
    const data = await res.json();
    return json(200, { cards: Array.isArray(data) ? data.slice(0, 40) : [] }, {
      'Cache-Control': 'private, max-age=300',
      Vary: 'Cookie',
    });
  } catch (err) {
    console.error('digimon-search:', err.message);
    return json(502, { error: 'El catálogo de Digimon no está disponible ahora mismo' });
  }
};
