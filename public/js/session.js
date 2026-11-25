// Guarda de sesión + cabecera común para las páginas internas.
import { api } from './api.js';
import { el } from './ui.js';
import { loadGames, fetchGames } from './games-cache.js';

const USER_KEY = 'tcg.user.v1';

// Service worker (uso sin conexión). Al cerrar sesión se borra la caché con los datos de la cuenta.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
const clearAccountCache = () => (window.caches ? window.caches.delete('tcg-api-v1').catch(() => {}) : Promise.resolve());

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
    // Sin conexión no es lo mismo que sin sesión: solo se sale si el servidor dice que no hay sesión
    if (err && err.status !== 401) return offlineUser();
    try { window.localStorage.removeItem(USER_KEY); } catch (e) { /* sin almacenamiento */ }
    clearAccountCache();
    window.location.replace('/');
    // Detenemos la ejecución del resto de la página mientras redirige
    return new Promise(() => {});
  }
}

// Sin conexión se sigue con el último usuario conocido (los datos vienen de la caché del service worker)
function offlineUser() {
  const name = lastUser || 'sin conexión';
  renderHeader({ username: name });
  return { id: '', username: name, offline: true };
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
      await clearAccountCache();
      try { window.localStorage.removeItem(USER_KEY); } catch (err) { /* sin almacenamiento */ }
      window.location.replace('/');
    }
  });
  const theme = el('button', { class: 'theme-btn', type: 'button', title: 'Cambiar tema claro/oscuro', 'aria-label': 'Cambiar tema claro/oscuro' });
  // Iconos SVG (en vez de emojis, que se dibujan descentrados según la fuente del sistema)
  const SUN = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>';
  const MOON = '<path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z"/>';
  const paint = () => {
    const light = window.tcgTheme && window.tcgTheme.get() === 'light';
    theme.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${light ? MOON : SUN}</svg>`;
  };
  theme.addEventListener('click', () => { if (window.tcgTheme) window.tcgTheme.toggle(); paint(); });
  paint();
  header.append(el('div', { class: 'header-user' }, theme, el('span', { class: 'muted', text: `👤 ${username}` }), logout));
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
