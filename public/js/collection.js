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

// ---------- Mi colección ----------
// Cartas visibles según la búsqueda, los filtros y el orden (todo en el navegador)
let filters = null;
function visibleCards() {
  const text = filterInput.value;
  const values = filters ? filters.values : {};
  return sortCards(cards.filter((c) => matchesName(c, text) && matchesFilters(c, values)), sortSelect.value);
}

function renderStats(list) {
  const total = list.reduce((sum, c) => sum + c.quantity, 0);
  const filtered = list.length !== cards.length;
  clear(statsBox);
  statsBox.append(
    el('span', {}, 'Cartas distintas: ', el('strong', { text: filtered ? `${list.length} de ${cards.length}` : list.length })),
    el('span', {}, 'Total de copias: ', el('strong', { text: total }))
  );
}

function renderCollection() {
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
          el('div', { class: 'meta', text: `${card.condition} · ${langShort(card.language)} · ${card.finish}` })
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

// ---------- Catálogo ----------
async function addFromCatalog(result) {
  try {
    await api.post('/collection', {
      game: game.key,
      cardId: result.cardId,
      name: result.name,
      imageUrl: result.imageUrl,
      imageBack: result.imageBack || '',
      backKind: result.backKind || '',
      setCode: result.setCode,
      rarity: result.rarity,
      facets: result.facets || undefined,
      language: result.language || catalogLang, // idioma de esta copia (nombre e imagen oficiales)
      quantity: 1,
    });
    toast(`${result.name} añadida`, 'success');
    loadCollection();
  } catch (err) {
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
    renderAction: (card) => el('button', { class: 'btn btn-sm', type: 'button', text: 'Añadir', onClick: () => addFromCatalog(card) }),
  });
}

filterInput.addEventListener('input', debounce(renderCollection, 200));
sortSelect.addEventListener('change', renderCollection);

// ---------- Inicio ----------
async function init() {
  await requireSession();
  game = await loadGame();

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
  });
  document.getElementById('filters-active').append(filters.activeBox);

  loadCollection();
}

initCardPreview();
init();
