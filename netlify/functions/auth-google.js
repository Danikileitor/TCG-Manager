// Inicio de sesión con Google (Google Identity Services).
// El navegador recibe un ID token firmado por Google y nos lo envía; aquí lo
// VERIFICAMOS en el servidor (firma, caducidad, emisor y audiencia) antes de
// confiar en él. Nunca se confía en datos de identidad enviados por el cliente.
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('./_lib/db');
const { signToken, sessionCookie } = require('./_lib/auth');
const { json, parseBody, requireJson, serverError } = require('./_lib/http');

let client = null;

function getClient() {
  if (!client) client = new OAuth2Client();
  return client;
}

// Genera un nombre de usuario válido (3-20 caracteres: letras, números o _)
function baseUsername(payload) {
  const raw = (payload.given_name || payload.email.split('@')[0] || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 14);
  return raw.length >= 3 ? raw : `user${raw}`.slice(0, 14);
}

function candidateUsername(base, attempt) {
  if (attempt === 0) return base;
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${base}_${suffix}`; // máx. 14 + 1 + 4 = 19 caracteres
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
    return json(401, { error: 'Token de Google no válido o caducado' });
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
    //    NO se vincula automáticamente: el registro con contraseña no verifica el
    //    email, y vincular permitiría que alguien que se registró antes con el
    //    email de otra persona se quedara con acceso a su cuenta.
    const byEmail = await users.findOne({ email });
    if (byEmail) {
      return json(409, {
        error: 'Ya existe una cuenta con este email. Inicia sesión con tu usuario y contraseña.',
      });
    }

    // 4) Cuenta nueva
    const base = baseUsername(payload);
    for (let attempt = 0; attempt < 6; attempt++) {
      const doc = {
        username: candidateUsername(base, attempt),
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
        if (keys.includes('username')) continue; // nombre ocupado: probar otro
        if (keys.includes('googleId')) {
          // Carrera: otra petición acaba de crear esta misma cuenta
          const existing = await users.findOne({ googleId });
          if (existing) return sessionResponse(200, existing);
        }
        return json(409, { error: 'Ya existe una cuenta con este email.' });
      }
    }
    return json(500, { error: 'No se pudo crear el usuario, inténtalo de nuevo' });
  } catch (err) {
    return serverError(err);
  }
};
