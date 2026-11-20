// Caché en el navegador de la lista de TCG (stale-while-revalidate).
//
// - Con caché reciente: devuelve la lista al instante y NO hace ninguna petición.
// - Con caché antigua: devuelve la lista al instante y la refresca en segundo plano
//   (si cambió, avisa con el callback onUpdate para repintar).
// - Sin caché (primera visita): pide la lista al servidor.
//
// La lista de TCG es pública (nombres, colores...), no contiene datos del usuario.
import { api } from './api.js';

const KEY = 'tcg.games.v1';
const FRESH_MS = 10 * 60 * 1000; // 10 minutos sin volver a preguntar al servidor

function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { games, ts } = JSON.parse(raw);
    return Array.isArray(games) && games.length ? { games, ts: Number(ts) || 0 } : null;
  } catch (err) {
    return null; // almacenamiento bloqueado o JSON corrupto: se ignora la caché
  }
}

function write(games) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ games, ts: Date.now() }));
  } catch (err) {
    // sin almacenamiento (modo privado, cuota...): la web funciona igual, sin caché
  }
}

let inflight = null;

// Pide la lista al servidor (evita peticiones duplicadas simultáneas) y la guarda
export function fetchGames() {
  if (!inflight) {
    inflight = api
      .get('/games')
      .then(({ games }) => {
        write(games);
        return games;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Lista guardada (si la hay), sin ninguna petición. Útil para pintar al instante.
export function getCachedGames() {
  const cached = read();
  return cached ? cached.games : null;
}

export async function loadGames(onUpdate) {
  const cached = read();
  if (!cached) return fetchGames();

  if (Date.now() - cached.ts > FRESH_MS) {
    fetchGames()
      .then((fresh) => {
        if (onUpdate && JSON.stringify(fresh) !== JSON.stringify(cached.games)) onUpdate(fresh);
      })
      .catch(() => {}); // si falla el refresco seguimos con la caché
  }
  return cached.games;
}
