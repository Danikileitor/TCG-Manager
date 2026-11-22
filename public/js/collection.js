// Colección del usuario para un TCG (/collection?game=...)
import { api } from './api.js';
import { requireSession, loadGame } from './session.js';
import { searchCatalog } from './card-providers.js';
import { createCatalogSearch } from './catalog-search.js';
import { setupLanguageSelect, langShort } from './language.js';
import { el, clear, toast, cardThumb, debounce, trashIcon } from './ui.js';

const collectionGrid = document.getElementById('collection-grid');
const resultList = document.getElementById('result-list');
const filterInput = document.getElementById('filter-input');
const filterLang = document.getElementById('filter-lang');
const langSelect = document.getElementById('lang-select');
const statsBox = document.getElementById('stats');

let game = null;
let cards = [];
let catalogLang = 'en'; // idioma elegido para buscar en el catálogo

// ---------- Mi colección ----------
// Cartas visibles según el filtro de idioma (se filtra en el navegador)
function visibleCards() {
  return filterLang.value ? cards.filter((c) => c.language === filterLang.value) : cards;
}

// El filtro de idioma ofrece solo los idiomas que el usuario tiene en su colección
function refreshLanguageFilter() {
  const selected = filterLang.value;
  const present = [...new Set(cards.map((c) => c.language).filter(Boolean))].sort();
  clear(filterLang);
  filterLang.append(el('option', { value: '', text: 'Todos los idiomas' }));
  present.forEach((code) => filterLang.append(el('option', { value: code, text: langShort(code) })));
  filterLang.value = present.includes(selected) ? selected : '';
}

function renderStats(list) {
  const total = list.reduce((sum, c) => sum + c.quantity, 0);
  clear(statsBox);
  statsBox.append(
    el('span', {}, 'Cartas distintas: ', el('strong', { text: list.length })),
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
          ? 'No tienes cartas en este idioma.'
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
  const q = filterInput.value.trim();
  const params = new URLSearchParams({ game: game.key });
  if (q) params.set('q', q);
  try {
    ({ cards } = await api.get(`/collection?${params}`));
    refreshLanguageFilter();
    renderCollection();
  } catch (err) {
    toast(err.message, 'error');
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
    refreshLanguageFilter();
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
      setCode: result.setCode,
      rarity: result.rarity,
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

filterInput.addEventListener('input', debounce(loadCollection, 350));
filterLang.addEventListener('change', renderCollection);

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

  loadCollection();
}

init();
