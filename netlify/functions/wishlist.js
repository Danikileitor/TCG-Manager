// Lista de deseos: cartas que el usuario quiere conseguir (separada de la colección).
//   GET ?game=       lista
//   POST             { game, cardId, name, ..., quantity }  añade (suma si ya estaba)
//   POST ?bulk=1     { game, cards: [{ cardId, name, quantity, ... }] }  varias a la vez
//   PUT              { id, quantity }
//   DELETE ?id=
const { ObjectId } = require('mongodb');
const { getDb } = require('./_lib/db');
const { getUserFromRequest } = require('./_lib/auth');
const { VALID_GAME_KEYS, VALID_LANGUAGES } = require('./_lib/games');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

const str = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const qty = (v) => Math.max(1, Math.min(999, parseInt(v, 10) || 1));

function entry(user, game, c) {
  const cardId = str(c && c.cardId, 100);
  const name = str(c && c.name, 200);
  if (!cardId || !name) return null;
  return {
    key: { userId: user.id, game, cardId },
    set: {
      name,
      altName: str(c.altName, 200),
      imageUrl: str(c.imageUrl, 500),
      imageBack: str(c.imageBack, 500),
      backKind: str(c.backKind, 20),
      setCode: str(c.setCode, 30),
      number: str(c.number, 20),
      rarity: str(c.rarity, 50),
      language: VALID_LANGUAGES.includes(c.language) ? c.language : 'en',
      updatedAt: new Date(),
    },
    quantity: qty(c.quantity),
  };
}

exports.handler = async (event) => {
  const user = getUserFromRequest(event);
  if (!user) return json(401, { error: 'No autorizado' });
  const method = event.httpMethod;
  const qs = event.queryStringParameters || {};
  try {
    const col = (await getDb()).collection('wishlist');

    if (method === 'GET') {
      const filter = { userId: user.id };
      if (qs.game) {
        if (!VALID_GAME_KEYS.includes(qs.game)) return json(400, { error: 'TCG no válido' });
        filter.game = qs.game;
      }
      return json(200, { cards: await col.find(filter).sort({ name: 1 }).limit(2000).toArray() });
    }

    if (method !== 'DELETE' && !requireJson(event)) return json(415, { error: 'Content-Type debe ser application/json' });

    if (method === 'POST') {
      const body = parseBody(event);
      if (!body) return json(400, { error: 'JSON inválido' });
      const game = str(body.game);
      if (!VALID_GAME_KEYS.includes(game)) return json(400, { error: 'TCG no válido' });
      const list = qs.bulk ? (Array.isArray(body.cards) ? body.cards.slice(0, 500) : null) : [body];
      if (!list) return json(400, { error: 'JSON inválido' });
      const ops = list
        .map((c) => entry(user, game, c))
        .filter(Boolean)
        .map((e) => ({ updateOne: { filter: e.key, update: { $inc: { quantity: e.quantity }, $set: e.set, $setOnInsert: { createdAt: new Date() } }, upsert: true } }));
      if (!ops.length) return json(400, { error: 'cardId y name son obligatorios' });
      await col.bulkWrite(ops, { ordered: false });
      return json(qs.bulk ? 200 : 201, { added: ops.length });
    }

    if (method === 'PUT') {
      const body = parseBody(event);
      if (!body || !ObjectId.isValid(body.id)) return json(400, { error: 'ID no válido' });
      const result = await col.findOneAndUpdate({ _id: new ObjectId(body.id), userId: user.id }, { $set: { quantity: qty(body.quantity), updatedAt: new Date() } }, { returnDocument: 'after' });
      if (!result) return json(404, { error: 'Carta no encontrada' });
      return json(200, { card: result });
    }

    if (method === 'DELETE') {
      if (!ObjectId.isValid(qs.id)) return json(400, { error: 'ID no válido' });
      const r = await col.deleteOne({ _id: new ObjectId(qs.id), userId: user.id });
      if (r.deletedCount === 0) return json(404, { error: 'Carta no encontrada' });
      return json(200, { ok: true });
    }
    return json(405, { error: 'Método no permitido' });
  } catch (err) {
    return serverError(err);
  }
};
