// Constructor de mazos (/deck-builder?game=...)
import { api } from './api.js';
import { requireSession, loadGame } from './session.js';
import { searchCatalog } from './card-providers.js';
import { createCatalogSearch, resultItem } from './catalog-search.js';
import { initCardPreview } from './card-viewer.js';
import { markPreviewable } from './ui.js';
import { setupLanguageSelect, langShort } from './language.js';
import { el, clear, toast, debounce } from './ui.js';

// Etiqueta con el idioma de una carta (ES, EN, FR...)
function langBadge(code) {
  return code ? el('span', { class: 'lang-badge', text: langShort(code) }) : null;
}

const ZONE_LABELS = {
  main: 'Mazo principal',
  side: 'Side Deck / Sideboard',
  extra: 'Extra Deck',
  commander: 'Comandante',
  'digi-egg': 'Digi-Egg Deck',
};

// Reglas orientativas (solo avisos, no bloquean el guardado)
function deckHints(gameKey, format, totals) {
  const hints = [];
  const total = (z) => totals[z] || 0;

  if (gameKey === 'ygo') {
    if (total('main') < 40 || total('main') > 60) hints.push('El Main Deck debe tener entre 40 y 60 cartas.');
    if (total('extra') > 15) hints.push('El Extra Deck admite como máximo 15 cartas.');
    if (total('side') > 15) hints.push('El Side Deck admite como máximo 15 cartas.');
  }
  if (gameKey === 'digimon') {
    if (total('main') !== 50) hints.push('El mazo principal debe tener exactamente 50 cartas.');
    if (total('digi-egg') > 5) hints.push('El Digi-Egg Deck admite como máximo 5 cartas.');
  }
  if (gameKey === 'mtg') {
    if (format === 'commander') {
      const all = total('main') + total('commander');
      if (all !== 100) hints.push(`En Commander el mazo debe tener 100 cartas (ahora ${all}).`);
      if (total('commander') < 1) hints.push('Falta elegir un comandante.');
    } else {
      if (total('main') < 60) hints.push('El mazo principal debe tener al menos 60 cartas.');
      if (total('side') > 15) hints.push('El sideboard admite como máximo 15 cartas.');
    }
  }
  return hints;
}

// ---------- Estado ----------
let game = null;
let decks = [];
let deck = null; // { _id?, name, format, description, cards: [] }
let dirty = false;
let source = 'collection'; // 'collection' | 'catalog'
let catalogLang = 'en'; // idioma elegido para buscar en el catálogo

const els = {
  picker: document.getElementById('deck-select'),
  newBtn: document.getElementById('new-deck-btn'),
  editor: document.getElementById('editor'),
  emptyState: document.getElementById('empty-state'),
  name: document.getElementById('deck-name'),
  format: document.getElementById('deck-format'),
  description: document.getElementById('deck-description'),
  zones: document.getElementById('zones'),
  hints: document.getElementById('hints'),
  saveBtn: document.getElementById('save-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  targetZone: document.getElementById('target-zone'),
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
  resultList: document.getElementById('result-list'),
  srcCollection: document.getElementById('src-collection'),
  srcCatalog: document.getElementById('src-catalog'),
  langField: document.getElementById('lang-field'),
  langSelect: document.getElementById('lang-select'),
  langNote: document.getElementById('lang-note'),
};

function markDirty() {
  dirty = true;
  els.saveBtn.textContent = 'Guardar cambios *';
}

// ---------- Lista de mazos ----------
function renderPicker(selectedId) {
  clear(els.picker);
  els.picker.append(el('option', { value: '', text: decks.length ? '— Elige un mazo —' : '— Aún no tienes mazos —' }));
  decks.forEach((d) => els.picker.append(el('option', { value: d._id, text: d.name })));
  els.picker.value = selectedId || '';
}

async function loadDecks(selectedId) {
  ({ decks } = await api.get(`/decks?game=${encodeURIComponent(game.key)}`));
  renderPicker(selectedId);
}

async function openDeck(id) {
  if (dirty && !window.confirm('Tienes cambios sin guardar. ¿Descartarlos?')) {
    els.picker.value = deck && deck._id ? deck._id : '';
    return;
  }
  if (!id) return showEditor(null);
  try {
    const { deck: loaded } = await api.get(`/decks?id=${encodeURIComponent(id)}`);
    showEditor(loaded);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showEditor(newDeck) {
  deck = newDeck;
  dirty = false;
  els.saveBtn.textContent = 'Guardar mazo';
  els.editor.classList.toggle('hidden', !deck);
  els.emptyState.classList.toggle('hidden', !!deck);
  if (!deck) return;

  els.name.value = deck.name;
  els.format.value = deck.format;
  els.description.value = deck.description || '';
  els.deleteBtn.classList.toggle('hidden', !deck._id);
  renderZones();
}

function newDeck() {
  if (dirty && !window.confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
  els.picker.value = '';
  showEditor({ name: 'Mazo nuevo', format: game.formats[0], description: '', cards: [] });
  els.name.focus();
  els.name.select();
}

// ---------- Cartas del mazo ----------
function renderZones() {
  clear(els.zones);
  const totals = {};

  game.deckZones.forEach((zone) => {
    const inZone = deck.cards.filter((c) => c.zone === zone);
    totals[zone] = inZone.reduce((sum, c) => sum + c.quantity, 0);

    const list = el('div', {});
    if (inZone.length === 0) list.append(el('div', { class: 'muted', text: 'Vacío' }));

    inZone
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((card) => {
        const minus = el('button', { type: 'button', text: '−', 'aria-label': 'Quitar una copia', onClick: () => changeQty(card, -1) });
        list.append(
          el(
            'div',
            { class: 'deck-row' },
            markPreviewable(el('span', { class: 'deck-name' }, card.name, langBadge(card.language)), card),
            el(
              'span',
              { class: 'qty' },
              minus,
              el('span', { text: `x${card.quantity}` }),
              el('button', { type: 'button', text: '+', 'aria-label': 'Añadir una copia', onClick: () => changeQty(card, 1) })
            ),
            el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: '✕', 'aria-label': 'Quitar del mazo', onClick: () => removeCard(card) })
          )
        );
      });

    els.zones.append(
      el(
        'section',
        { class: 'zone' },
        el(
          'div',
          { class: 'zone-head' },
          el('h3', { text: ZONE_LABELS[zone] || zone }),
          el('span', { class: 'zone-count', text: `${totals[zone]} cartas` })
        ),
        list
      )
    );
  });

  clear(els.hints);
  const hints = deckHints(game.key, deck.format, totals);
  if (hints.length) {
    const ul = el('ul', { class: 'hint-list' });
    hints.forEach((h) => ul.append(el('li', { text: h })));
    els.hints.append(ul);
  }
}

function addCardToDeck(card, zoneOverride) {
  if (!deck) return toast('Crea o selecciona un mazo primero', 'error');

  const wanted = zoneOverride && zoneOverride !== 'auto' ? zoneOverride : card.zoneHint || 'main';
  const zone = game.deckZones.includes(wanted) ? wanted : 'main';

  const existing = deck.cards.find((c) => c.cardId === card.cardId && c.zone === zone);
  if (existing) {
    existing.quantity = Math.min(99, existing.quantity + 1);
  } else {
    deck.cards.push({
      cardId: card.cardId,
      name: card.name,
      imageUrl: card.imageUrl || '',
      imageBack: card.imageBack || '',
      language: card.language || catalogLang,
      quantity: 1,
      zone,
    });
  }
  markDirty();
  renderZones();
}

function changeQty(card, delta) {
  card.quantity += delta;
  if (card.quantity <= 0) return removeCard(card);
  card.quantity = Math.min(99, card.quantity);
  markDirty();
  renderZones();
}

function removeCard(card) {
  deck.cards = deck.cards.filter((c) => c !== card);
  markDirty();
  renderZones();
}

// ---------- Guardar / borrar ----------
async function saveDeck() {
  const payload = {
    name: els.name.value.trim(),
    format: els.format.value,
    description: els.description.value.trim(),
    cards: deck.cards,
  };
  if (!payload.name) return toast('El mazo necesita un nombre', 'error');

  els.saveBtn.disabled = true;
  try {
    let saved;
    if (deck._id) {
      ({ deck: saved } = await api.put('/decks', { id: deck._id, ...payload }));
    } else {
      ({ deck: saved } = await api.post('/decks', { game: game.key, ...payload }));
    }
    toast('Mazo guardado', 'success');
    await loadDecks(saved._id);
    showEditor(saved);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function deleteDeck() {
  if (!deck || !deck._id) return;
  if (!window.confirm(`¿Eliminar el mazo "${deck.name}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api.del(`/decks?id=${encodeURIComponent(deck._id)}`);
    toast('Mazo eliminado', 'success');
    await loadDecks('');
    showEditor(null);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Origen de cartas: colección o catálogo ----------
let catalogSearch = null;

function buildCatalogSearch() {
  catalogSearch = createCatalogSearch({
    gameKey: game.key,
    getLang: () => catalogLang,
    mount: document.getElementById('catalog-search'),
    resultList: els.resultList,
    idleMessage: 'Busca una carta por nombre o usa los filtros para añadirla al mazo.',
    search: (req) => searchCatalog(game.key, req.query, catalogLang, req),
    renderAction: (card) =>
      el('button', { class: 'btn btn-sm', type: 'button', text: '+ Mazo', onClick: () => addCardToDeck(card, els.targetZone.value) }),
  });
}

function setSource(newSource) {
  source = newSource;
  const inCatalog = source === 'catalog';
  els.srcCollection.classList.toggle('active', !inCatalog);
  els.srcCatalog.classList.toggle('active', inCatalog);
  // El idioma y los filtros solo se usan al buscar en el catálogo; las cartas de la colección ya tienen el suyo
  els.langField.classList.toggle('hidden', !inCatalog);
  els.searchForm.classList.toggle('hidden', inCatalog);
  document.getElementById('catalog-search').classList.toggle('hidden', !inCatalog);

  if (inCatalog) {
    catalogSearch.refresh();
    if (!els.resultList.firstChild) catalogSearch.showIdle();
  } else {
    catalogSearch.cancel();
    runSearch();
  }
}

// Resultados de "Mi colección"
function renderResults(results) {
  clear(els.resultList);
  if (results.length === 0) {
    els.resultList.append(el('div', { class: 'empty', text: 'Tu colección está vacía o no hay coincidencias.' }));
    return;
  }
  results.forEach((r) => {
    els.resultList.append(
      resultItem(r, el('button', { class: 'btn btn-sm', type: 'button', text: '+ Mazo', onClick: () => addCardToDeck(r, els.targetZone.value) }))
    );
  });
}

async function runSearch() {
  const q = els.searchInput.value.trim();
  clear(els.resultList);
  els.resultList.append(el('div', { class: 'spinner' }));
  try {
    const params = new URLSearchParams({ game: game.key });
    if (q) params.set('q', q);
    const { cards } = await api.get(`/collection?${params}`);
    renderResults(cards.map((c) => ({ ...c, typeLine: '', zoneHint: 'main' })));
  } catch (err) {
    clear(els.resultList);
    els.resultList.append(el('div', { class: 'empty', text: err.message }));
  }
}

// ---------- Eventos ----------
els.picker.addEventListener('change', () => openDeck(els.picker.value));
els.newBtn.addEventListener('click', newDeck);
els.saveBtn.addEventListener('click', saveDeck);
els.deleteBtn.addEventListener('click', deleteDeck);
els.srcCollection.addEventListener('click', () => setSource('collection'));
els.srcCatalog.addEventListener('click', () => setSource('catalog'));
els.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});
els.searchInput.addEventListener('input', debounce(() => source === 'collection' && runSearch(), 350));

[els.name, els.description].forEach((input) =>
  input.addEventListener('input', () => {
    if (deck) markDirty();
  })
);
els.format.addEventListener('change', () => {
  if (!deck) return;
  deck.format = els.format.value;
  markDirty();
  renderZones();
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Inicio ----------
async function init() {
  await requireSession();
  game = await loadGame();

  document.getElementById('game-name').textContent = game.name;
  const key = encodeURIComponent(game.key);
  document.getElementById('nav-collection').href = `/collection?game=${key}`;
  document.getElementById('nav-decks').href = `/deck-builder?game=${key}`;

  // Formatos y zonas de destino según el TCG
  game.formats.forEach((f) => els.format.append(el('option', { value: f, text: f })));
  els.targetZone.append(el('option', { value: 'auto', text: 'Zona: automática' }));
  game.deckZones.forEach((z) => els.targetZone.append(el('option', { value: z, text: ZONE_LABELS[z] || z })));

  // Idioma de las cartas del catálogo
  catalogLang = setupLanguageSelect({
    select: els.langSelect,
    noteEl: els.langNote,
    gameKey: game.key,
    onChange: (code) => {
      catalogLang = code;
      if (source === 'catalog') catalogSearch.refresh();
    },
  });

  buildCatalogSearch();

  try {
    await loadDecks('');
  } catch (err) {
    toast(err.message, 'error');
  }
  showEditor(null);
  setSource('collection');
}

initCardPreview();
init();
