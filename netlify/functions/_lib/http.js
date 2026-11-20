// Helpers para respuestas HTTP y lectura del cuerpo.
function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch (err) {
    return null; // JSON inválido
  }
}

// Protección CSRF adicional: las peticiones que modifican datos deben ser JSON
function requireJson(event) {
  const type = event.headers['content-type'] || event.headers['Content-Type'] || '';
  return type.includes('application/json');
}

function serverError(err) {
  console.error(err);
  return json(500, { error: 'Error interno del servidor' });
}

module.exports = { json, parseBody, requireJson, serverError };
