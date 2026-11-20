// Utilidades de sesión: JWT guardado en cookie httpOnly.
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'token';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 días

function getSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('Falta la variable de entorno JWT_SECRET');
  }
  return process.env.JWT_SECRET;
}

function signToken(user) {
  return jwt.sign(
    { id: String(user._id), username: user.username },
    getSecret(),
    { expiresIn: MAX_AGE }
  );
}

function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return acc;
  }, {});
}

// Devuelve { id, username } o null si no hay sesión válida
function getUserFromRequest(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getSecret());
    return { id: payload.id, username: payload.username };
  } catch (err) {
    return null;
  }
}

function sessionCookie(token) {
  // En "netlify dev" (http://localhost) no se puede usar Secure
  const secure = process.env.NETLIFY_DEV === 'true' ? '' : ' Secure;';
  return `${COOKIE_NAME}=${token}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${MAX_AGE}`;
}

function clearCookie() {
  const secure = process.env.NETLIFY_DEV === 'true' ? '' : ' Secure;';
  return `${COOKIE_NAME}=; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=0`;
}

module.exports = { signToken, getUserFromRequest, sessionCookie, clearCookie };
