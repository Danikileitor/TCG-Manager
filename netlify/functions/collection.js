const { ObjectId } = require('mongodb');
const { getDb } = require('./_lib/db');
const { getUserFromRequest } = require('./_lib/auth');
const { VALID_GAME_KEYS, VALID_LANGUAGES } = require('./_lib/games');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

const FINISHES = ['normal', 'foil', 'etched', '1st', 'unlimited', 'limited'];
const CONDITIONS = ['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

// Datos para filtrar la colección (ver facets en card-providers.js): solo se guardan estos campos y con límites
function num(v) {
  return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(-999999, Math.min(9999999, Number(v)));
}
function strList(v, maxItems = 12) {
  return Array.isArray(v) ? [...new Set(v.map((x) => str(x, 40)).filter(Boolean))].slice(0, maxItems) : [];
}
function sanitizeFacets(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  return {
    colors: strList(f.colors, 6),
    types: strList(f.types, 12),
    subtypes: strList(f.subtypes, 16),
    attribute: str(f.attribute, 40),
    cost: num(f.cost),
    level: num(f.level),
    power: num(f.power),
  };
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
      const cards = await col.find(filter).sort({ name: 1 }).limit(5000).toArray();
      return json(200, { cards });
    }

    // Las operaciones de escritura requieren JSON
    if (!requireJson(event) && method !== 'DELETE') {
      return json(415, { error: 'Content-Type debe ser application/json' });
    }

    // ---------- IMPORTAR varias cartas a la vez: ?bulk=1 { game, replace?, cards: [...] } ----------
    // Suma cantidades a las variantes que ya existen (misma clave que al añadir una a una).
    // replace: true borra antes la colección de ese TCG (el cliente solo lo envía en el primer lote).
    if (method === 'POST' && qs.bulk) {
      const body = parseBody(event);
      if (!body || !Array.isArray(body.cards)) return json(400, { error: 'JSON inválido' });
      const game = str(body.game);
      if (!VALID_GAME_KEYS.includes(game)) return json(400, { error: 'TCG no válido' });
      if (body.cards.length > 500) return json(400, { error: 'Máximo 500 cartas por lote' });

      let removed = 0;
      if (body.replace === true) removed = (await col.deleteMany({ userId: user.id, game })).deletedCount;

      const now = new Date();
      const ops = [];
      for (const c of body.cards) {
        const cardId = str(c && c.cardId, 100);
        const name = str(c && c.name, 200);
        if (!cardId || !name) continue;
        const key = {
          userId: user.id,
          game,
          cardId,
          language: VALID_LANGUAGES.includes(c.language) ? c.language : 'en',
          finish: FINISHES.includes(c.finish) ? c.finish : 'normal',
          condition: CONDITIONS.includes(c.condition) ? c.condition : 'NM',
        };
        const facets = sanitizeFacets(c.facets);
        ops.push({
          updateOne: {
            filter: key,
            update: {
              $inc: { quantity: Math.max(1, Math.min(999, parseInt(c.quantity, 10) || 1)) },
              $set: {
                name,
                imageUrl: str(c.imageUrl, 500),
                imageBack: str(c.imageBack, 500),
                backKind: str(c.backKind, 20),
                setCode: str(c.setCode, 30),
                ...(str(c.altName, 200) ? { altName: str(c.altName, 200) } : {}),
                ...(str(c.variant, 10) ? { variant: str(c.variant, 10) } : {}),
                ...(str(c.number, 20) ? { number: str(c.number, 20) } : {}),
                rarity: str(c.rarity, 50),
                ...(str(c.notes, 500) ? { notes: str(c.notes, 500) } : {}),
                ...(facets ? { facets } : {}),
                updatedAt: now,
              },
              $setOnInsert: { acquiredAt: now },
            },
            upsert: true,
          },
        });
      }
      if (ops.length) await col.bulkWrite(ops, { ordered: false });
      return json(200, { imported: ops.length, removed });
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

      // Idioma de ESTA copia de la carta (una carta en español y otra en inglés son entradas distintas)
      const language = VALID_LANGUAGES.includes(body.language) ? body.language : 'en';
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
            imageBack: str(body.imageBack, 500),
            backKind: str(body.backKind, 20),
            setCode: str(body.setCode, 30),
            ...(str(body.altName, 200) ? { altName: str(body.altName, 200) } : {}),
            ...(str(body.variant, 10) ? { variant: str(body.variant, 10) } : {}),
            ...(str(body.number, 20) ? { number: str(body.number, 20) } : {}),
            rarity: str(body.rarity, 50),
            notes: str(body.notes, 500),
            ...(sanitizeFacets(body.facets) ? { facets: sanitizeFacets(body.facets) } : {}),
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

      // Completar datos de filtrado de varias cartas a la vez: { items: [{ id, facets }] }
      if (body && Array.isArray(body.items)) {
        const ops = body.items
          .slice(0, 500)
          .filter((it) => it && ObjectId.isValid(it.id) && sanitizeFacets(it.facets))
          .map((it) => ({ updateOne: { filter: { _id: new ObjectId(it.id), userId: user.id }, update: { $set: { facets: sanitizeFacets(it.facets) } } } }));
        if (ops.length) await col.bulkWrite(ops, { ordered: false });
        return json(200, { updated: ops.length });
      }

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
