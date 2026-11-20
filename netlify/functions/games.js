const { getDb } = require('./_lib/db');
const { getUserFromRequest } = require('./_lib/auth');
const { getGames } = require('./_lib/games');
const { json, serverError } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });

  const user = getUserFromRequest(event);
  if (!user) return json(401, { error: 'No autorizado' });

  try {
    const db = await getDb();
    const games = await getGames(db);
    // El navegador también la guarda 5 min (privada: la respuesta exige sesión) y puede
    // servir la versión anterior hasta 1 día mientras se refresca en segundo plano.
    return json(
      200,
      { games },
      {
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=86400',
        Vary: 'Cookie',
      }
    );
  } catch (err) {
    return serverError(err);
  }
};
