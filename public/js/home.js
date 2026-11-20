// Página principal: muestra los TCG disponibles
import { requireSession } from './session.js';
import { loadGames } from './games-cache.js';
import { el, clear } from './ui.js';

const grid = document.getElementById('game-grid');

function gameCard(game) {
  const card = el(
    'article',
    { class: 'game-card' },
    el('span', { class: 'game-badge', text: game.short }),
    el('h2', { text: game.name }),
    el('p', { text: game.description }),
    el(
      'div',
      { class: 'game-actions' },
      el('a', { class: 'btn', href: `/collection?game=${encodeURIComponent(game.key)}`, text: 'Mi colección' }),
      el('a', {
        class: 'btn btn-ghost',
        href: `/deck-builder?game=${encodeURIComponent(game.key)}`,
        text: 'Mis mazos',
      })
    )
  );
  card.style.setProperty('--game-color', game.color);
  return card;
}

function renderGames(games) {
  clear(grid);
  games.forEach((g) => grid.append(gameCard(g)));
}

function init() {
  // La sesión y los TCG se piden EN PARALELO (antes iban uno detrás de otro).
  // Con caché, los TCG aparecen al instante sin esperar a ninguna petición.
  const sessionPromise = requireSession();

  loadGames(renderGames)
    .then(renderGames)
    .catch((err) => {
      clear(grid);
      grid.append(el('div', { class: 'empty', text: `No se pudieron cargar los TCG: ${err.message}` }));
    });

  sessionPromise.then((user) => {
    document.getElementById('welcome').textContent = `Hola, ${user.username}`;
  });
}

init();
