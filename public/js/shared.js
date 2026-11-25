// Página pública de un mazo compartido (/d/<id>): solo lectura, no necesita sesión.
import { api } from './api.js';
import { el, clear, toast, markPreviewable } from './ui.js';
import { initCardPreview } from './card-viewer.js';
import { displayName } from './card-labels.js';
import { exportDeck } from './transfer.js';

const GAMES = { mtg: 'Magic: The Gathering', ygo: 'Yu-Gi-Oh!', digimon: 'Digimon Card Game' };
const ZONES = { main: 'Mazo principal', side: 'Side Deck / Sideboard', extra: 'Extra Deck', commander: 'Comandante', 'digi-egg': 'Digi-Egg Deck' };
const ORDER = ['commander', 'main', 'extra', 'digi-egg', 'side'];
const FORMATS = { 'c-u': 'C / U', 'speed-duel': 'Speed Duel' };

async function init() {
  const id = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  const zones = document.getElementById('zones');
  let deck;
  try {
    ({ deck } = await api.get(`/shared-deck?id=${encodeURIComponent(id)}`));
  } catch (err) {
    clear(zones);
    zones.append(el('div', { class: 'empty', text: err.message }));
    return;
  }
  document.title = `${deck.name} · TCG Manager`;
  document.getElementById('deck-title').textContent = deck.name;
  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  document.getElementById('deck-sub').textContent = `${GAMES[deck.game] || deck.game} · ${FORMATS[deck.format] || deck.format} · ${total} cartas`;
  document.getElementById('deck-desc').textContent = deck.description || '';
  document.documentElement.style.setProperty('--accent', { mtg: '#7c3aed', ygo: '#d97706', digimon: '#0891b2' }[deck.game] || '#6d7cff');

  clear(zones);
  ORDER.filter((z) => deck.cards.some((c) => c.zone === z)).forEach((zone) => {
    const inZone = deck.cards.filter((c) => c.zone === zone);
    const list = el('div', { class: 'deck-list' });
    inZone.forEach((c) =>
      list.append(
        el('div', { class: 'deck-row shared-row' }, markPreviewable(el('span', { class: 'deck-name', text: displayName(c, deck.game) }), c), el('span', { class: 'qty-static', text: `x${c.quantity}` }))
      )
    );
    zones.append(el('section', { class: 'zone' }, el('div', { class: 'zone-head' }, el('h3', { text: ZONES[zone] || zone }), el('span', { class: 'zone-count', text: `${inZone.reduce((s, c) => s + c.quantity, 0)} cartas` })), list));
  });
  initCardPreview();

  const exportBtn = document.getElementById('export-btn');
  exportBtn.classList.remove('hidden');
  exportBtn.addEventListener('click', () => {
    const fmt = deck.game === 'ygo' ? 'ydk' : 'text';
    navigator.clipboard.writeText(exportDeck(fmt, deck.game, deck).text).then(() => toast('Lista copiada', 'success'), () => toast('No se pudo copiar', 'error'));
  });

  // Si hay sesión se puede copiar el mazo a la cuenta propia
  const copyBtn = document.getElementById('copy-btn');
  try {
    await api.get('/auth/me');
    copyBtn.classList.remove('hidden');
    copyBtn.addEventListener('click', async () => {
      copyBtn.disabled = true;
      try {
        const { deck: saved } = await api.post('/decks', { game: deck.game, name: `${deck.name} (copia)`, format: deck.format, description: deck.description, cards: deck.cards, cover: deck.cover });
        window.location.href = `/deck-builder?game=${encodeURIComponent(deck.game)}&deck=${encodeURIComponent(saved._id)}`;
      } catch (err) {
        toast(err.message, 'error');
        copyBtn.disabled = false;
      }
    });
  } catch (err) {
    document.getElementById('login-link').classList.remove('hidden');
  }
}

init();
