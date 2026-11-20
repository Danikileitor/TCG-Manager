const bcrypt = require('bcryptjs');
const { getDb } = require('./_lib/db');
const { signToken, sessionCookie } = require('./_lib/auth');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!requireJson(event)) return json(415, { error: 'Content-Type debe ser application/json' });

  const body = parseBody(event);
  if (!body) return json(400, { error: 'JSON inválido' });

  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!USERNAME_RE.test(username)) {
    return json(400, { error: 'El usuario debe tener 3-20 caracteres (letras, números o _)' });
  }
  if (!EMAIL_RE.test(email)) return json(400, { error: 'Email no válido' });
  if (password.length < 8 || password.length > 100) {
    return json(400, { error: 'La contraseña debe tener entre 8 y 100 caracteres' });
  }

  try {
    const db = await getDb();
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.collection('users').insertOne({
      username,
      email,
      passwordHash,
      createdAt: new Date(),
    });

    const token = signToken({ _id: result.insertedId, username });
    return json(
      201,
      { user: { id: String(result.insertedId), username } },
      { 'Set-Cookie': sessionCookie(token) }
    );
  } catch (err) {
    if (err && err.code === 11000) {
      return json(409, { error: 'Ya existe una cuenta con ese usuario o email' });
    }
    return serverError(err);
  }
};
