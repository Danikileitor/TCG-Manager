// Inicio de sesión / alta con Google (Google Identity Services).
// El navegador recibe un ID token firmado por Google y nos lo envía; aquí lo
// VERIFICAMOS en el servidor (firma, caducidad, emisor y audiencia) antes de
// confiar en él. Nunca se confía en datos de identidad enviados por el cliente.
//
// Flujo en dos pasos para cuentas nuevas:
//   1) POST { credential }             -> cuenta ya existente: sesión iniciada (200)
//                                         cuenta nueva: { needsUsername, suggestedUsername } (200)
//   2) POST { credential, username }   -> crea la cuenta con el nombre elegido (201)
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('./_lib/db');
const { signToken, sessionCookie } = require('./_lib/auth');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
// Comparación sin distinguir mayúsculas/minúsculas ("Ana" y "ana" son el mismo nombre)
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

let client = null;

function getClient() {
  if (!client) client = new OAuth2Client();
  return client;
}

async function usernameTaken(users, username) {
  const found = await users.findOne(
    { username },
    { collation: CASE_INSENSITIVE, projection: { _id: 1 } }
  );
  return !!found;
}

// Nombre sugerido a partir del nombre de Google (válido y libre)
function baseUsername(payload) {
  const raw = (payload.given_name || payload.email.split('@')[0] || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 14);
  return raw.length >= 3 ? raw : `user${raw}`.slice(0, 14);
}

async function suggestUsername(users, payload) {
  const base = baseUsername(payload);
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const candidate = attempt === 0 ? base : `${base}_${suffix}`; // máx. 14 + 1 + 4 = 19
    if (!(await usernameTaken(users, candidate))) return candidate;
  }
  return base;
}

function sessionResponse(statusCode, user) {
  return json(
    statusCode,
    { user: { id: String(user._id), username: user.username } },
    { 'Set-Cookie': sessionCookie(signToken(user)) }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!requireJson(event)) return json(415, { error: 'Content-Type debe ser application/json' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json(503, { error: 'El inicio de sesión con Google no está configurado' });

  const body = parseBody(event);
  if (!body || typeof body.credential !== 'string' || body.credential.length > 4096) {
    return json(400, { error: 'Falta el token de Google' });
  }

  // 1) Verificar el token con Google
  let payload;
  try {
    const ticket = await getClient().verifyIdToken({ idToken: body.credential, audience: clientId });
    payload = ticket.getPayload();
  } catch (err) {
    return json(401, { error: 'La sesión de Google ha caducado o no es válida. Vuelve a pulsar el botón de Google.' });
  }

  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
    return json(401, { error: 'Tu cuenta de Google no tiene el email verificado' });
  }

  const googleId = payload.sub;
  const email = payload.email.trim().toLowerCase();

  try {
    const db = await getDb();
    const users = db.collection('users');

    // 2) ¿Ya está vinculado este Google ID? -> iniciar sesión
    const byGoogle = await users.findOne({ googleId });
    if (byGoogle) return sessionResponse(200, byGoogle);

    // 3) ¿Existe una cuenta con ese email creada con contraseña?
    //    NO se vincula automáticamente: el registro con contraseña no verifica el email y
    //    vincular permitiría que alguien que se registró antes con el email de otra
    //    persona se quedara con acceso a su cuenta.
    const byEmail = await users.findOne({ email });
    if (byEmail) {
      return json(409, {
        error: 'Ya existe una cuenta con este email. Inicia sesión con tu usuario y contraseña.',
      });
    }

    // 4) Cuenta nueva, paso 1: todavía no hay nombre de usuario -> lo pedimos
    if (body.username === undefined) {
      return json(200, {
        needsUsername: true,
        email,
        suggestedUsername: await suggestUsername(users, payload),
      });
    }

    // 5) Cuenta nueva, paso 2: validar el nombre elegido y crear la cuenta
    const username = String(body.username).trim();
    if (!USERNAME_RE.test(username)) {
      return json(400, { error: 'El usuario debe tener 3-20 caracteres (letras, números o _)' });
    }
    if (await usernameTaken(users, username)) {
      return json(409, { error: 'Ese nombre de usuario ya está en uso. Elige otro.' });
    }

    const doc = {
      username,
      email,
      passwordHash: null, // cuenta solo-Google, sin contraseña
      googleId,
      authProvider: 'google',
      createdAt: new Date(),
    };

    try {
      const result = await users.insertOne(doc);
      return sessionResponse(201, { ...doc, _id: result.insertedId });
    } catch (err) {
      if (!err || err.code !== 11000) throw err;
      const keys = Object.keys(err.keyPattern || {});
      if (keys.includes('username')) {
        return json(409, { error: 'Ese nombre de usuario ya está en uso. Elige otro.' });
      }
      if (keys.includes('googleId')) {
        // Carrera: otra petición acaba de crear esta misma cuenta
        const existing = await users.findOne({ googleId });
        if (existing) return sessionResponse(200, existing);
      }
      return json(409, { error: 'Ya existe una cuenta con este email.' });
    }
  } catch (err) {
    return serverError(err);
  }
};
