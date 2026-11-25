// Mazo compartido: devuelve un mazo por su enlace público (/d/<id>). No requiere sesión.
// Solo expone nombre, formato, descripción y cartas; nunca el usuario ni otros datos.
const { getDb } = require('./_lib/db');
const { json, serverError } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  const id = String((event.queryStringParameters || {}).id || '');
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(id)) return json(400, { error: 'Enlace no válido' });
  try {
    const db = await getDb();
    const deck = await db.collection('decks').findOne({ shareId: id }, { projection: { name: 1, game: 1, format: 1, description: 1, cards: 1, cover: 1, updatedAt: 1 } });
    if (!deck) return json(404, { error: 'Este mazo no existe o ya no se comparte' });
    const res = json(200, { deck: { name: deck.name, game: deck.game, format: deck.format, description: deck.description, cards: deck.cards, cover: deck.cover, updatedAt: deck.updatedAt } });
    res.headers['Cache-Control'] = 'public, max-age=30';
    return res;
  } catch (err) {
    return serverError(err);
  }
};
