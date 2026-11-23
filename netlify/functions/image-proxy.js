// Proxy de imágenes de cartas. Solo lo usa el simulador de mano inicial cuando el servidor de una imagen no
// permite leerla desde el navegador (CORS): así se puede dibujar en WebGL y detectar bordes en blanco.
// Seguridad: solo usuarios con sesión, solo HTTPS, solo servidores de imágenes de la lista de abajo (también
// al seguir redirecciones), solo respuestas image/* y con un tamaño máximo.
const { getUserFromRequest } = require('./_lib/auth');
const { json } = require('./_lib/http');

const ALLOWED_HOSTS = new Set([
  'web-garage.takaotaku.de',
  'images.digimoncard.io',
  'world.digimoncard.com',
  'cards.scryfall.io',
  'backs.scryfall.io',
  'images.ygoprodeck.com',
]);
const MAX_BYTES = 6 * 1024 * 1024 - 200 * 1024; // el límite de respuesta de las funciones es 6 MB (en base64 pesa 1/3 más; las cartas son mucho menores)
const MAX_BYTES_RAW = 4 * 1024 * 1024;

function allowed(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch (err) {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  if (!getUserFromRequest(event)) return json(401, { error: 'No autorizado' });

  let target = String((event.queryStringParameters || {}).u || '');
  if (!allowed(target)) return json(400, { error: 'Imagen no permitida' });

  try {
    let res;
    for (let hops = 0; hops < 4; hops++) {
      res = await fetch(target, { redirect: 'manual', headers: { Accept: 'image/*', 'User-Agent': 'tcg-manager-image-proxy' }, signal: AbortSignal.timeout(8000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        target = new URL(res.headers.get('location'), target).toString();
        if (!allowed(target)) return json(400, { error: 'Redirección no permitida' });
        continue;
      }
      break;
    }
    if (!res.ok) return json(502, { error: 'Imagen no disponible' });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(type)) return json(415, { error: 'No es una imagen' });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES_RAW || buf.length > MAX_BYTES) return json(413, { error: 'Imagen demasiado grande' });
    return {
      statusCode: 200,
      isBase64Encoded: true,
      body: buf.toString('base64'),
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=86400',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    };
  } catch (err) {
    return json(502, { error: 'Imagen no disponible' });
  }
};
