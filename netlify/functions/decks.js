const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDb } = require('./_lib/db');
const { getUserFromRequest } = require('./_lib/auth');
const { DEFAULT_GAMES, VALID_GAME_KEYS, VALID_LANGUAGES } = require('./_lib/games');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

// Datos de la carta para las estadísticas del mazo (mismo formato que en la colección)
function num(v) {
  return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(-999999, Math.min(9999999, Number(v)));
}
function strList(v, maxItems = 12) {
  return Array.isArray(v) ? [...new Set(v.map((x) => str(x, 40)).filter(Boolean))].slice(0, maxItems) : [];
}
function sanitizeFacets(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  return { colors: strList(f.colors, 6), types: strList(f.types, 12), subtypes: strList(f.subtypes, 16), attribute: str(f.attribute, 40), cost: num(f.cost), level: num(f.level), power: num(f.power) };
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
    variant: str(c.variant, 10),
    setCode: str(c.setCode, 30),
    number: str(c.number, 20),
    imageUrl: str(c.imageUrl, 500),
    imageBack: str(c.imageBack, 500),
    backKind: str(c.backKind, 20),
    language: VALID_LANGUAGES.includes(c.language) ? c.language : 'en',
    facets: sanitizeFacets(c.facets),
    quantity: Math.max(1, Math.min(99, parseInt(c.quantity, 10) || 1)),
    zone: zones.includes(c.zone) ? c.zone : 'main',
  })).filter((c) => c.cardId && c.name);
}

// La zona Comandante solo existe en el formato Commander: en los demás las cartas pasan al mazo principal
function fixZones(cards, format) {
  return format === 'commander' ? cards : cards.map((c) => (c.zone === 'commander' ? { ...c, zone: 'main' } : c));
}

// Formato del mazo: debe existir en el TCG (el antiguo "casual" ya no existe: se usa el primero del juego)
function validFormat(gameKey, value) {
  const def = DEFAULT_GAMES.find((g) => g.key === gameKey);
  const formats = (def && def.formats) || [];
  const v = str(value, 30);
  return formats.includes(v) ? v : formats[0] || v;
}

// Carta insignia del mazo (imagen de portada): debe ser una de las cartas del mazo
function sanitizeCover(cover, cards) {
  if (!cover || typeof cover !== 'object') return null;
  const cardId = str(cover.cardId, 100);
  const inDeck = cards.find((c) => c.cardId === cardId);
  if (!inDeck) return null;
  return { cardId, name: inDeck.name, imageUrl: inDeck.imageUrl, imageBack: inDeck.imageBack, backKind: inDeck.backKind };
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
        const history = deck.history || [];
        delete deck.history; // el historial pesa: se pide aparte
        // Historial: ?history=1 lista las versiones; ?version=N devuelve una (0 = la más reciente)
        if (qs.history) {
          return json(200, { versions: history.map((h, i) => ({ index: i, savedAt: h.savedAt, name: h.name, format: h.format, cardCount: (h.cards || []).reduce((s, c) => s + c.quantity, 0) })).reverse() });
        }
        if (qs.version !== undefined) {
          const v = history[parseInt(qs.version, 10)];
          if (!v) return json(404, { error: 'Versión no encontrada' });
          return json(200, { version: v });
        }
        return json(200, { deck });
      }

      const filter = { userId: user.id };
      if (qs.game) {
        if (!VALID_GAME_KEYS.includes(qs.game)) return json(400, { error: 'TCG no válido' });
        filter.game = qs.game;
      }
      // En el listado no enviamos todas las cartas, solo un resumen
      // (más el número de cartas y la primera carta, por si el mazo no tiene carta insignia)
      const decks = await col
        .aggregate([
          { $match: filter },
          { $sort: { updatedAt: -1 } },
          { $limit: 200 },
          { $addFields: { cardCount: { $sum: '$cards.quantity' }, firstCard: { $arrayElemAt: ['$cards', 0] } } },
          { $project: { cards: 0, history: 0, 'firstCard.language': 0, 'firstCard.quantity': 0, 'firstCard.zone': 0 } },
        ])
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
        format: validFormat(game, body.format),
        description: str(body.description, 1000),
        cards: [],
        cover: null,
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      };
      doc.cards = fixZones(sanitizeCards(body.cards, game), doc.format);
      doc.cover = sanitizeCover(body.cover, doc.cards);
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
      if (body.format !== undefined) update.format = validFormat(existing.game, body.format);
      if (body.description !== undefined) update.description = str(body.description, 1000);
      const format = update.format || existing.format;
      if (body.cards !== undefined) update.cards = fixZones(sanitizeCards(body.cards, existing.game), format);
      else if (update.format) update.cards = fixZones(existing.cards || [], format);
      if (body.cover !== undefined || body.cards !== undefined) {
        // La carta insignia se mantiene mientras siga en el mazo
        update.cover = sanitizeCover(body.cover !== undefined ? body.cover : existing.cover, update.cards || existing.cards);
      }

      // Compartir: enlace público de solo lectura (se activa y desactiva; al desactivar el enlace deja de funcionar)
      if (body.share === true && !existing.shareId) update.shareId = crypto.randomBytes(9).toString('base64url');
      if (body.share === false) update.shareId = null;

      // Historial: antes de cambiar las cartas se guarda la versión anterior (las 15 últimas)
      const ops = { $set: update };
      if (update.cards && JSON.stringify(update.cards) !== JSON.stringify(existing.cards || [])) {
        ops.$push = { history: { $each: [{ savedAt: existing.updatedAt || new Date(), name: existing.name, format: existing.format, cards: existing.cards || [] }], $slice: -15 } };
      }
      const result = await col.findOneAndUpdate(
        { _id: existing._id, userId: user.id },
        ops,
        { returnDocument: 'after', projection: { history: 0 } }
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
