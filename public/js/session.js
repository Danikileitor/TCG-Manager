// Guarda de sesión + cabecera común para las páginas internas.
import { api } from './api.js';
import { el } from './ui.js';
import { loadGames, fetchGames } from './games-cache.js';

export async function requireSession() {
  try {
    const { user } = await api.get('/auth/me');
    renderHeader(user);
    return user;
  } catch (err) {
    window.location.replace('/');
    // Detenemos la ejecución del resto de la página mientras redirige
    return new Promise(() => {});
  }
}

function renderHeader(user) {
  const header = document.getElementById('app-header');
  if (!header) return;

  const logout = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cerrar sesión' });
  logout.addEventListener('click', async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      window.location.replace('/');
    }
  });

  header.classList.add('app-header');
  header.append(
    el(
      'a',
      { class: 'brand', href: '/home' },
      el('img', { class: 'brand-logo', src: '/favicon-96x96.png', alt: '' }),
      'TCG Manager'
    ),
    el('div', { class: 'header-user' }, el('span', { class: 'muted', text: `👤 ${user.username}` }), logout)
  );
}

// Carga los datos del TCG indicado en ?game=... y aplica su color de acento
export async function loadGame() {
  const key = new URLSearchParams(window.location.search).get('game');
  let game = (await loadGames()).find((g) => g.key === key);
  // Si la caché no lo conoce (p. ej. TCG recién añadido), preguntamos al servidor
  if (!game) game = (await fetchGames()).find((g) => g.key === key);
  if (!game) {
    window.location.replace('/home');
    return new Promise(() => {});
  }
  document.documentElement.style.setProperty('--accent', game.color);
  document.title = `${game.name} · TCG Manager`;
  return game;
}
