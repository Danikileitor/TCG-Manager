const { ObjectId } = require('mongodb');
const { getDb } = require('./_lib/db');
const { getUserFromRequest } = require('./_lib/auth');
const { VALID_GAME_KEYS } = require('./_lib/games');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

const FINISHES = ['normal', 'foil', 'etched', '1st', 'unlimited', 'limited'];
const CONDITIONS = ['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

exports.handler = async (event) => {
  const user = getUserFromRequest(event);
  if (!user) return json(401, { error: 'No autorizado' });

  const method = event.httpMethod;
  const qs = event.queryStringParameters || {};

  try {
    const db = await getDb();
    const col = db.collection('usercards');

    // ---------- LISTAR ----------
    if (method === 'GET') {
      const filter = { userId: user.id };
      if (qs.game) {
        if (!VALID_GAME_KEYS.includes(qs.game)) return json(400, { error: 'TCG no válido' });
        filter.game = qs.game;
      }
      if (qs.q) {
        filter.name = { $regex: escapeRegex(str(qs.q, 60)), $options: 'i' };
      }
      const cards = await col.find(filter).sort({ name: 1 }).limit(1000).toArray();
      return json(200, { cards });
    }

    // Las operaciones de escritura requieren JSON
    if (!requireJson(event) && method !== 'DELETE') {
      return json(415, { error: 'Content-Type debe ser application/json' });
    }

    // ---------- AÑADIR (suma cantidad si ya existe la misma variante) ----------
    if (method === 'POST') {
      const body = parseBody(event);
      if (!body) return json(400, { error: 'JSON inválido' });

      const game = str(body.game);
      const cardId = str(body.cardId, 100);
      const name = str(body.name, 200);
      const quantity = Math.max(1, Math.min(999, parseInt(body.quantity, 10) || 1));

      if (!VALID_GAME_KEYS.includes(game)) return json(400, { error: 'TCG no válido' });
      if (!cardId || !name) return json(400, { error: 'cardId y name son obligatorios' });

      const language = str(body.language || 'es', 10).toLowerCase();
      const finish = FINISHES.includes(body.finish) ? body.finish : 'normal';
      const condition = CONDITIONS.includes(body.condition) ? body.condition : 'NM';

      const key = { userId: user.id, game, cardId, language, finish, condition };
      const now = new Date();

      await col.updateOne(
        key,
        {
          $inc: { quantity },
          $set: {
            name,
            imageUrl: str(body.imageUrl, 500),
            setCode: str(body.setCode, 30),
            rarity: str(body.rarity, 50),
            notes: str(body.notes, 500),
            updatedAt: now,
          },
          $setOnInsert: { acquiredAt: now },
        },
        { upsert: true }
      );
      const saved = await col.findOne(key);
      return json(201, { card: saved });
    }

    // ---------- ACTUALIZAR cantidad / notas ----------
    if (method === 'PUT') {
      const body = parseBody(event);
      if (!body || !ObjectId.isValid(body.id)) return json(400, { error: 'ID no válido' });

      const update = { updatedAt: new Date() };
      if (body.quantity !== undefined) {
        update.quantity = Math.max(1, Math.min(999, parseInt(body.quantity, 10) || 1));
      }
      if (body.notes !== undefined) update.notes = str(body.notes, 500);
      if (CONDITIONS.includes(body.condition)) update.condition = body.condition;

      // Siempre filtramos por userId del token, nunca por uno enviado por el cliente
      const result = await col.findOneAndUpdate(
        { _id: new ObjectId(body.id), userId: user.id },
        { $set: update },
        { returnDocument: 'after' }
      );
      if (!result) return json(404, { error: 'Carta no encontrada' });
      return json(200, { card: result });
    }

    // ---------- ELIMINAR ----------
    if (method === 'DELETE') {
      if (!ObjectId.isValid(qs.id)) return json(400, { error: 'ID no válido' });
      const result = await col.deleteOne({ _id: new ObjectId(qs.id), userId: user.id });
      if (result.deletedCount === 0) return json(404, { error: 'Carta no encontrada' });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Método no permitido' });
  } catch (err) {
    if (err && err.code === 11000) return json(409, { error: 'La carta ya existe' });
    return serverError(err);
  }
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
