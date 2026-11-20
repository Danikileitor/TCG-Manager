const { clearCookie } = require('./_lib/auth');
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });
};
