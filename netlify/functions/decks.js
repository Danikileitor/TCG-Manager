const { ObjectId } = require('mongodb');
const { getDb } = require('./_lib/db');
const { getUserFromRequest } = require('./_lib/auth');
const { DEFAULT_GAMES, VALID_GAME_KEYS, VALID_LANGUAGES } = require('./_lib/games');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

// Valida y normaliza las cartas del mazo según las zonas del TCG
function sanitizeCards(cards, game) {
  const gameDef = DEFAULT_GAMES.find((g) => g.key === game);
  const zones = gameDef ? gameDef.deckZones : ['main'];
  if (!Array.isArray(cards)) return [];

  return cards.slice(0, 300).map((c) => ({
    cardId: str(c.cardId, 100),
    name: str(c.name, 200),
    altName: str(c.altName, 200),
    setCode: str(c.setCode, 30),
    number: str(c.number, 20),
    imageUrl: str(c.imageUrl, 500),
    imageBack: str(c.imageBack, 500),
    backKind: str(c.backKind, 20),
    language: VALID_LANGUAGES.includes(c.language) ? c.language : 'en',
    quantity: Math.max(1, Math.min(99, parseInt(c.quantity, 10) || 1)),
    zone: zones.includes(c.zone) ? c.zone : 'main',
  })).filter((c) => c.cardId && c.name);
}

exports.handler = async (event) => {
  const user = getUserFromRequest(event);
  if (!user) return json(401, { error: 'No autorizado' });

  const method = event.httpMethod;
  const qs = event.queryStringParameters || {};

  try {
    const db = await getDb();
    const col = db.collection('decks');

    // ---------- LISTAR / OBTENER UNO ----------
    if (method === 'GET') {
      if (qs.id) {
        if (!ObjectId.isValid(qs.id)) return json(400, { error: 'ID no válido' });
        const deck = await col.findOne({ _id: new ObjectId(qs.id), userId: user.id });
        if (!deck) return json(404, { error: 'Mazo no encontrado' });
        return json(200, { deck });
      }

      const filter = { userId: user.id };
      if (qs.game) {
        if (!VALID_GAME_KEYS.includes(qs.game)) return json(400, { error: 'TCG no válido' });
        filter.game = qs.game;
      }
      // En el listado no enviamos todas las cartas, solo un resumen
      const decks = await col
        .find(filter)
        .project({ cards: 0 })
        .sort({ updatedAt: -1 })
        .limit(200)
        .toArray();
      return json(200, { decks });
    }

    if (method !== 'DELETE' && !requireJson(event)) {
      return json(415, { error: 'Content-Type debe ser application/json' });
    }

    // ---------- CREAR ----------
    if (method === 'POST') {
      const body = parseBody(event);
      if (!body) return json(400, { error: 'JSON inválido' });

      const game = str(body.game);
      const name = str(body.name, 100);
      if (!VALID_GAME_KEYS.includes(game)) return json(400, { error: 'TCG no válido' });
      if (!name) return json(400, { error: 'El mazo necesita un nombre' });

      const now = new Date();
      const doc = {
        userId: user.id,
        game,
        name,
        format: str(body.format || 'casual', 30),
        description: str(body.description, 1000),
        cards: sanitizeCards(body.cards, game),
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      };
      const result = await col.insertOne(doc);
      return json(201, { deck: { ...doc, _id: result.insertedId } });
    }

    // ---------- ACTUALIZAR ----------
    if (method === 'PUT') {
      const body = parseBody(event);
      if (!body || !ObjectId.isValid(body.id)) return json(400, { error: 'ID no válido' });

      const existing = await col.findOne({ _id: new ObjectId(body.id), userId: user.id });
      if (!existing) return json(404, { error: 'Mazo no encontrado' });

      const update = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const name = str(body.name, 100);
        if (!name) return json(400, { error: 'El mazo necesita un nombre' });
        update.name = name;
      }
      if (body.format !== undefined) update.format = str(body.format, 30);
      if (body.description !== undefined) update.description = str(body.description, 1000);
      if (body.cards !== undefined) update.cards = sanitizeCards(body.cards, existing.game);

      const result = await col.findOneAndUpdate(
        { _id: existing._id, userId: user.id },
        { $set: update },
        { returnDocument: 'after' }
      );
      return json(200, { deck: result });
    }

    // ---------- ELIMINAR ----------
    if (method === 'DELETE') {
      if (!ObjectId.isValid(qs.id)) return json(400, { error: 'ID no válido' });
      const result = await col.deleteOne({ _id: new ObjectId(qs.id), userId: user.id });
      if (result.deletedCount === 0) return json(404, { error: 'Mazo no encontrado' });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Método no permitido' });
  } catch (err) {
    return serverError(err);
  }
};
