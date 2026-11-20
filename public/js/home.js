// Página principal: muestra los TCG disponibles
import { api } from './api.js';
import { requireSession } from './session.js';
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
      el('a', { class: 'btn', href: `collection.html?game=${encodeURIComponent(game.key)}`, text: 'Mi colección' }),
      el('a', {
        class: 'btn btn-ghost',
        href: `deck-builder.html?game=${encodeURIComponent(game.key)}`,
        text: 'Mis mazos',
      })
    )
  );
  card.style.setProperty('--game-color', game.color);
  return card;
}

async function init() {
  const user = await requireSession();
  document.getElementById('welcome').textContent = `Hola, ${user.username}`;

  try {
    const { games } = await api.get('/games');
    clear(grid);
    games.forEach((g) => grid.append(gameCard(g)));
  } catch (err) {
    clear(grid);
    grid.append(el('div', { class: 'empty', text: `No se pudieron cargar los TCG: ${err.message}` }));
  }
}

init();
