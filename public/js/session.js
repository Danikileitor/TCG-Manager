// Guarda de sesión + cabecera común para las páginas internas.
import { api } from './api.js';
import { el } from './ui.js';
import { loadGames, fetchGames } from './games-cache.js';

const USER_KEY = 'tcg.user.v1';

// La marca se pinta al instante (sin esperar a ninguna petición); el usuario se completa cuando se sabe.
// Para que no "salte", se enseña el último usuario conocido mientras se confirma la sesión.
function ensureBrand() {
  const header = document.getElementById('app-header');
  if (!header) return null;
  header.classList.add('app-header');
  if (!header.querySelector('.brand')) {
    header.prepend(el('a', { class: 'brand', href: '/home' }, el('img', { class: 'brand-logo', src: '/favicon-96x96.png', alt: '' }), 'TCG Manager'));
  }
  return header;
}
let lastUser = '';
try { lastUser = window.localStorage.getItem(USER_KEY) || ''; } catch (err) { /* sin almacenamiento */ }
const earlyHeader = ensureBrand();
if (earlyHeader && lastUser) renderUser(earlyHeader, lastUser);

export async function requireSession() {
  try {
    const { user } = await api.get('/auth/me');
    try { window.localStorage.setItem(USER_KEY, user.username); } catch (err) { /* sin almacenamiento */ }
    renderHeader(user);
    return user;
  } catch (err) {
    try { window.localStorage.removeItem(USER_KEY); } catch (e) { /* sin almacenamiento */ }
    window.location.replace('/');
    // Detenemos la ejecución del resto de la página mientras redirige
    return new Promise(() => {});
  }
}

function renderHeader(user) {
  const header = ensureBrand();
  if (header) renderUser(header, user.username);
}

function renderUser(header, username) {
  const old = header.querySelector('.header-user');
  if (old) old.remove();
  const logout = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cerrar sesión' });
  logout.addEventListener('click', async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      try { window.localStorage.removeItem(USER_KEY); } catch (err) { /* sin almacenamiento */ }
      window.location.replace('/');
    }
  });
  header.append(el('div', { class: 'header-user' }, el('span', { class: 'muted', text: `👤 ${username}` }), logout));
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
  game = { ...game, formats: (game.formats || []).filter((f) => f !== 'casual') }; // el formato "casual" ya no existe
  document.documentElement.style.setProperty('--accent', game.color);
  document.title = `${game.name} · TCG Manager`;
  return game;
}
