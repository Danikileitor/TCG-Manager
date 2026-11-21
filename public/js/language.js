// Idioma de las cartas: preferencia por TCG y selector reutilizable.
// La preferencia se guarda en el navegador (localStorage) y la web funciona igual si no se puede.
import { getLanguages, getLanguageNote } from './card-providers.js';
import { el, clear } from './ui.js';

const KEY = 'tcg.lang.v1';
const SHORT = { zhs: 'ZH-CN', zht: 'ZH-TW' };

// Etiqueta corta para mostrar junto a una carta: es -> ES, zhs -> ZH-CN
export function langShort(code) {
  return SHORT[code] || String(code || '').toUpperCase();
}

function readAll() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY)) || {};
  } catch (err) {
    return {};
  }
}

export function savePreferredLanguage(gameKey, code) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [gameKey]: code }));
  } catch (err) {
    // sin almacenamiento: la elección solo dura mientras la página esté abierta
  }
}

// Idioma guardado -> idioma del navegador (si el TCG lo ofrece) -> primero de la lista
export function getPreferredLanguage(gameKey) {
  const codes = getLanguages(gameKey).map((l) => l.code);
  const saved = readAll()[gameKey];
  if (codes.includes(saved)) return saved;

  const browser = String((navigator.language || 'en')).toLowerCase();
  let wanted = browser.split('-')[0];
  if (wanted === 'zh') wanted = /tw|hk|mo|hant/.test(browser) ? 'zht' : 'zhs';
  return codes.includes(wanted) ? wanted : codes[0];
}

// Rellena un <select> con los idiomas del TCG y avisa con onChange(code) al cambiar.
// Devuelve el idioma seleccionado inicialmente.
export function setupLanguageSelect({ select, noteEl, gameKey, onChange }) {
  const languages = getLanguages(gameKey);
  const current = getPreferredLanguage(gameKey);

  clear(select);
  languages.forEach((l) => select.append(el('option', { value: l.code, text: l.label })));
  select.value = current;
  select.disabled = languages.length < 2; // un solo idioma: se muestra pero no se puede cambiar

  if (noteEl) noteEl.textContent = getLanguageNote(gameKey);

  select.addEventListener('change', () => {
    savePreferredLanguage(gameKey, select.value);
    if (onChange) onChange(select.value);
  });
  return current;
}
