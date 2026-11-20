const { getUserFromRequest } = require('./_lib/auth');
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  const user = getUserFromRequest(event);
  if (!user) return json(401, { error: 'No autorizado' });
  return json(200, { user });
};
