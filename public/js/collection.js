// Colección del usuario para un TCG (/collection?game=...)
import { api } from './api.js';
import { requireSession, loadGame } from './session.js';
import { searchCatalog } from './card-providers.js';
import { createCatalogSearch } from './catalog-search.js';
import { initCardPreview } from './card-viewer.js';
import { setupLanguageSelect, langShort } from './language.js';
import { el, clear, toast, cardThumb, debounce, trashIcon } from './ui.js';
import { createCollectionFilters, matchesFilters, matchesName, sortCards, SORTS } from './collection-filters.js';
import { facetsForCards } from './card-providers.js';

const collectionGrid = document.getElementById('collection-grid');
const resultList = document.getElementById('result-list');
const filterInput = document.getElementById('filter-input');
const sortSelect = document.getElementById('sort-select');
const enrichStatus = document.getElementById('enrich-status');
const langSelect = document.getElementById('lang-select');
const statsBox = document.getElementById('stats');

let game = null;
let cards = [];
let catalogLang = 'en'; // idioma elegido para buscar en el catálogo
let view = 'collection'; // 'collection' | 'wishlist'
let wish = []; // lista de deseos de este TCG

const CONDITIONS = [['M', 'M (Mint)'], ['NM', 'NM'], ['EX', 'EX'], ['GD', 'GD'], ['LP', 'LP'], ['PL', 'PL'], ['PO', 'PO']];
const FINISHES = {
  mtg: [['normal', 'Normal'], ['foil', 'Foil ✨'], ['etched', 'Etched ✨']],
  ygo: [['normal', 'Normal'], ['foil', 'Foil ✨'], ['1st', '1ª edición'], ['unlimited', 'Unlimited'], ['limited', 'Limitada']],
  digimon: [['normal', 'Normal'], ['foil', 'Foil ✨']],
};

function miniSelect(label, options, value, onChange) {
  const select = el('select', { class: 'mini-select', 'aria-label': label, title: label });
  options.forEach(([v, text]) => select.append(el('option', { value: v, text })));
  if (!options.some(([v]) => v === value)) select.append(el('option', { value, text: value }));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

// Cambia el estado o el acabado de una copia (si ya había otra igual, el servidor fusiona las cantidades)
async function changeVariant(card, patch) {
  try {
    const { card: updated, mergedFrom } = await api.put('/collection', { id: card._id, ...patch });
    if (mergedFrom) {
      cards = cards.filter((c) => c._id !== mergedFrom);
      Object.assign(cards.find((c) => c._id === updated._id) || {}, updated);
      toast('Se han fusionado las copias idénticas', 'info');
    } else Object.assign(card, updated);
    renderCollection();
  } catch (err) {
    toast(err.message, 'error');
    renderCollection();
  }
}

// ---------- Mi colección ----------
// Cartas visibles según la búsqueda, los filtros y el orden (todo en el navegador)
let filters = null;
function visibleCards() {
  const text = filterInput.value;
  const values = filters ? filters.values : {};
  return sortCards(cards.filter((c) => matchesName(c, text) && matchesFilters(c, values, filters && filters.translate)), sortSelect.value);
}

function renderStats(list) {
  const total = list.reduce((sum, c) => sum + c.quantity, 0);
  const filtered = list.length !== cards.length;
  clear(statsBox);
  statsBox.append(
    el('span', {}, 'Cartas distintas: ', el('strong', { text: filtered ? `${list.length} de ${cards.length}` : list.length })),
    el('span', {}, 'Total de copias: ', el('strong', { text: total })),
    game.key === 'mtg' ? valueControl(list) : null
  );
}

// Valor estimado (solo MTG): se calcula a petición porque pide los precios a Scryfall en tandas de 75 cartas
let valueText = '';
function valueControl(list) {
  if (valueText) return el('span', { title: 'Precio de Cardmarket en euros vía Scryfall, sobre las cartas visibles' }, 'Valor: ', el('strong', { text: valueText }));
  const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Calcular valor' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { mtgPrices, euro } = await import('./prices.js');
      const prices = await mtgPrices(list, (done, total) => (btn.textContent = `Calculando… ${done}/${total}`));
      const priced = list.filter((c) => prices.get(c.cardId) != null);
      valueText = euro(priced.reduce((sum, c) => sum + prices.get(c.cardId) * c.quantity, 0)) + (priced.length < list.length ? ` (${list.length - priced.length} sin precio)` : '');
      renderCollection();
    } catch (err) {
      toast('No se pudieron obtener los precios', 'error');
      btn.disabled = false;
      btn.textContent = 'Calcular valor';
    }
  });
  return btn;
}

function renderCollection() {
  if (view === 'wishlist') return renderWishlist();
  clear(collectionGrid);
  const list = visibleCards();
  renderStats(list);

  if (list.length === 0) {
    collectionGrid.append(
      el('div', {
        class: 'empty',
        text: cards.length
          ? 'Ninguna carta de tu colección coincide con la búsqueda y los filtros.'
          : 'Todavía no tienes cartas aquí. Busca en el catálogo (panel derecho) y pulsa "Añadir".',
      })
    );
    return;
  }

  list.forEach((card) => {
    const minus = el('button', { type: 'button', text: '−', 'aria-label': 'Quitar una copia', onClick: () => changeQty(card, -1) });
    minus.disabled = card.quantity <= 1;

    collectionGrid.append(
      el(
        'article',
        { class: 'tcg-card' },
        cardThumb(card),
        el(
          'div',
          { class: 'info' },
          el('div', { class: 'name', text: card.name }),
          el('div', { class: 'meta', text: [card.setCode, card.rarity].filter(Boolean).join(' · ') }),
          el('div', { class: 'meta', text: langShort(card.language) }),
          el('div', { class: 'variant-row' },
            miniSelect('Estado', CONDITIONS, card.condition, (v) => changeVariant(card, { condition: v })),
            miniSelect('Acabado', FINISHES[game.key] || FINISHES.mtg, card.finish, (v) => changeVariant(card, { finish: v })))
        ),
        el(
          'div',
          { class: 'actions' },
          el(
            'span',
            { class: 'qty' },
            minus,
            el('span', { text: `x${card.quantity}` }),
            el('button', { type: 'button', text: '+', 'aria-label': 'Añadir una copia', onClick: () => changeQty(card, 1) })
          ),
          el('button', { class: 'btn btn-danger btn-sm btn-icon', type: 'button', title: 'Quitar de la colección', 'aria-label': 'Quitar de la colección', onClick: () => removeCard(card) }, trashIcon())
        )
      )
    );
  });
}

async function loadCollection() {
  try {
    ({ cards } = await api.get(`/collection?game=${encodeURIComponent(game.key)}`));
    renderCollection();
    enrichMissingFacets();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Las cartas guardadas antes de existir los filtros no tienen color, tipo, coste…: se completan una vez
// (se consultan al catálogo y se guardan en tu cuenta) y se vuelven a pintar.
let enriching = false;
async function enrichMissingFacets() {
  const missing = cards.filter((c) => !c.facets);
  if (enriching || missing.length === 0) return;
  enriching = true;
  enrichStatus.classList.remove('hidden');
  enrichStatus.textContent = `Completando datos de ${missing.length} cartas para poder filtrar…`;
  try {
    const found = await facetsForCards(game.key, missing, (done, total) => {
      enrichStatus.textContent = `Completando datos para filtrar… ${done}/${total}`;
    });
    const items = [];
    for (const card of missing) {
      const f = found.get(card.cardId);
      if (f) {
        card.facets = f;
        items.push({ id: card._id, facets: f });
      }
    }
    for (let i = 0; i < items.length; i += 400) await api.put('/collection', { items: items.slice(i, i + 400) });
    renderCollection();
    const left = cards.filter((c) => !c.facets).length;
    enrichStatus.textContent = left ? `${left} cartas sin datos de filtrado (no se encontraron en el catálogo o se reintentará en la próxima visita).` : '';
    enrichStatus.classList.toggle('hidden', !left);
  } catch (err) {
    enrichStatus.textContent = 'No se pudieron completar los datos para filtrar; se reintentará en la próxima visita.';
  } finally {
    enriching = false;
  }
}

async function changeQty(card, delta) {
  try {
    const { card: updated } = await api.put('/collection', { id: card._id, quantity: card.quantity + delta });
    Object.assign(card, updated);
    renderCollection();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeCard(card) {
  if (!window.confirm(`¿Quitar "${card.name}" de tu colección?`)) return;
  try {
    await api.del(`/collection?id=${encodeURIComponent(card._id)}`);
    cards = cards.filter((c) => c._id !== card._id);
    renderCollection();
    toast('Carta eliminada', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Wishlist ----------
async function loadWishlist() {
  try {
    ({ cards: wish } = await api.get(`/wishlist?game=${encodeURIComponent(game.key)}`));
    if (view === 'wishlist') renderCollection();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderWishlist() {
  clear(collectionGrid);
  const text = filterInput.value;
  const list = wish.filter((c) => matchesName(c, text));
  clear(statsBox);
  statsBox.append(
    el('span', {}, 'Cartas deseadas: ', el('strong', { text: list.length })),
    el('span', {}, 'Total de copias: ', el('strong', { text: list.reduce((s, c) => s + c.quantity, 0) }))
  );
  if (!list.length) {
    collectionGrid.append(el('div', { class: 'empty', text: wish.length ? 'Ninguna carta de la wishlist coincide con la búsqueda.' : 'Tu wishlist está vacía. En el catálogo pulsa ♡ en las cartas que quieras conseguir.' }));
    return;
  }
  list.forEach((card) => {
    const minus = el('button', { type: 'button', text: '−', 'aria-label': 'Quitar una copia', onClick: () => changeWishQty(card, -1) });
    minus.disabled = card.quantity <= 1;
    collectionGrid.append(
      el('article', { class: 'tcg-card' }, cardThumb(card),
        el('div', { class: 'info' }, el('div', { class: 'name', text: card.name }), el('div', { class: 'meta', text: [card.setCode, card.rarity].filter(Boolean).join(' · ') }), el('div', { class: 'meta', text: langShort(card.language) })),
        el('div', { class: 'actions' },
          el('span', { class: 'qty' }, minus, el('span', { text: `x${card.quantity}` }), el('button', { type: 'button', text: '+', 'aria-label': 'Añadir una copia', onClick: () => changeWishQty(card, 1) })),
          el('button', { class: 'btn btn-sm', type: 'button', text: 'La tengo', title: 'Pasarla a mi colección', onClick: () => wishToCollection(card) }),
          el('button', { class: 'btn btn-danger btn-sm btn-icon', type: 'button', title: 'Quitar de la wishlist', 'aria-label': 'Quitar de la wishlist', onClick: () => removeWish(card) }, trashIcon())))
    );
  });
}

async function changeWishQty(card, delta) {
  try {
    const { card: updated } = await api.put('/wishlist', { id: card._id, quantity: card.quantity + delta });
    Object.assign(card, updated);
    renderCollection();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeWish(card) {
  try {
    await api.del(`/wishlist?id=${encodeURIComponent(card._id)}`);
    wish = wish.filter((c) => c._id !== card._id);
    renderCollection();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wishToCollection(card) {
  try {
    await addFromCatalog({ ...card, language: card.language, quantity: card.quantity }, card.quantity, true);
    await api.del(`/wishlist?id=${encodeURIComponent(card._id)}`);
    wish = wish.filter((c) => c._id !== card._id);
    renderCollection();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function addToWishlist(result) {
  try {
    await api.post('/wishlist', { game: game.key, cardId: result.cardId, name: result.name, altName: result.altName || '', imageUrl: result.imageUrl, imageBack: result.imageBack || '', backKind: result.backKind || '', setCode: result.setCode, number: result.number || '', rarity: result.rarity, language: result.language || catalogLang, quantity: 1 });
    toast(`${result.name} añadida a la wishlist`, 'success');
    loadWishlist();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('view-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn || btn.dataset.view === view) return;
  view = btn.dataset.view;
  [...e.currentTarget.children].forEach((b) => b.classList.toggle('active', b === btn));
  document.getElementById('filters-mount').classList.toggle('hidden', view === 'wishlist');
  sortSelect.classList.toggle('hidden', view === 'wishlist');
  renderCollection();
});

// ---------- Catálogo ----------
async function addFromCatalog(result, quantity = 1, silent = false) {
  try {
    await api.post('/collection', {
      game: game.key,
      cardId: result.cardId,
      name: result.name,
      altName: result.altName || '',
      variant: result.variant || '',
      number: result.number || '',
      imageUrl: result.imageUrl,
      imageBack: result.imageBack || '',
      backKind: result.backKind || '',
      setCode: result.setCode,
      rarity: result.rarity,
      facets: result.facets || undefined,
      language: result.language || catalogLang, // idioma de esta copia (nombre e imagen oficiales)
      quantity,
    });
    if (!silent) toast(`${result.name} añadida`, 'success');
    loadCollection();
  } catch (err) {
    if (silent) throw err;
    toast(err.message, 'error');
  }
}

let catalogSearch = null;

function buildCatalogSearch() {
  catalogSearch = createCatalogSearch({
    gameKey: game.key,
    getLang: () => catalogLang,
    mount: document.getElementById('catalog-search'),
    resultList,
    idleMessage: 'Busca una carta por nombre o usa los filtros para añadirla a tu colección.',
    search: (req) => searchCatalog(game.key, req.query, catalogLang, req),
    renderAction: (card) =>
      el('div', { class: 'result-actions' },
        el('button', { class: 'btn btn-sm', type: 'button', text: 'Añadir', onClick: () => addFromCatalog(card) }),
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '♡', title: 'Añadir a la wishlist', 'aria-label': 'Añadir a la wishlist', onClick: () => addToWishlist(card) })),
  });
}

document.getElementById('transfer-btn').addEventListener('click', async () => {
  const { openTransferDialog } = await import('./transfer-dialog.js'); // se carga al usarlo
  openTransferDialog({
    kind: 'collection',
    gameKey: game.key,
    hasVisibleFilter: () => visibleCards().length !== cards.length,
    getExport: (onlyVisible) => (onlyVisible ? visibleCards() : cards),
    onImport: async ({ cards: incoming, replace, onProgress }) => {
      let imported = 0;
      for (let i = 0; i < incoming.length; i += 400) {
        const chunk = incoming.slice(i, i + 400);
        await api.post('/collection?bulk=1', { game: game.key, replace: replace && i === 0, cards: chunk });
        imported += chunk.length;
        onProgress(imported, incoming.length);
      }
      await loadCollection();
      return `${imported} cartas importadas`;
    },
  });
});

filterInput.addEventListener('input', debounce(renderCollection, 200));
sortSelect.addEventListener('change', renderCollection);

// ---------- Inicio ----------
async function init() {
  [, game] = await Promise.all([requireSession(), loadGame()]);

  document.getElementById('game-name').textContent = game.name;
  const key = encodeURIComponent(game.key);
  document.getElementById('nav-collection').href = `/collection?game=${key}`;
  document.getElementById('nav-decks').href = `/deck-builder?game=${key}`;

  catalogLang = setupLanguageSelect({
    select: langSelect,
    noteEl: document.getElementById('lang-note'),
    gameKey: game.key,
    onChange: (code) => {
      catalogLang = code;
      // Si ya había una búsqueda, se repite en el nuevo idioma
      catalogSearch.refresh();
    },
  });
  buildCatalogSearch();

  SORTS.forEach((o) => sortSelect.append(el('option', { value: o.value, text: o.label })));
  filters = createCollectionFilters({
    gameKey: game.key,
    mount: document.getElementById('filters-mount'),
    getCards: () => cards,
    onChange: renderCollection,
    getLang: () => catalogLang,
  });
  document.getElementById('filters-active').append(filters.activeBox);

  loadCollection();
  loadWishlist();
}

initCardPreview();
init();
