const bcrypt = require('bcryptjs');
const { getDb } = require('./_lib/db');
const { signToken, sessionCookie } = require('./_lib/auth');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

// Hash falso para igualar tiempos de respuesta cuando el usuario no existe
const DUMMY_HASH = '$2a$12$ZohZC82mQJaJDSYU61dU9uJ29JYQc7nXBcxVU.LinvD0NrAupuhn2';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!requireJson(event)) return json(415, { error: 'Content-Type debe ser application/json' });

  const body = parseBody(event);
  if (!body) return json(400, { error: 'JSON inválido' });

  const identifier = String(body.identifier || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!identifier || !password) {
    return json(400, { error: 'Introduce usuario/email y contraseña' });
  }

  try {
    const db = await getDb();
    const user = await db.collection('users').findOne({
      $or: [{ email: identifier }, { username: new RegExp(`^${escapeRegex(identifier)}$`, 'i') }],
    });

    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) {
      // Mensaje genérico: no revelamos si el usuario existe
      return json(401, { error: 'Credenciales incorrectas' });
    }

    const token = signToken(user);
    return json(
      200,
      { user: { id: String(user._id), username: user.username } },
      { 'Set-Cookie': sessionCookie(token) }
    );
  } catch (err) {
    return serverError(err);
  }
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
