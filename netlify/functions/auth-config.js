// Configuración pública para el frontend.
// El Client ID de Google es público por naturaleza (no es un secreto), pero lo
// servimos desde una variable de entorno para no escribirlo en el código.
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  return json(200, { googleClientId: process.env.GOOGLE_CLIENT_ID || null });
};
