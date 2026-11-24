// Constructor de mazos (/deck-builder?game=...)
import { api } from './api.js';
import { requireSession, loadGame } from './session.js';
import { searchCatalog, completeForExport, digimonVariantsFor } from './card-providers.js';
import { displayName } from './card-labels.js';
import { copiesLeft, copyLimit, overLimit } from './deck-rules.js';
import { openTransferDialog } from './transfer-dialog.js';
import { openHandSimulator } from './hand-sim.js';
import { createCatalogSearch, resultItem } from './catalog-search.js';
import { initCardPreview } from './card-viewer.js';
import { markPreviewable } from './ui.js';
import { setupLanguageSelect, langShort } from './language.js';
import { el, clear, toast, debounce, withImageFallback, safeImageUrl } from './ui.js';
import { betterImageUrl } from './card-images.js';
import { loadBanlists, ensureLegalities, statusFor, bannedPairsIn, banBadge } from './banlist.js';

const FORMAT_LABELS = { 'c-u': 'C / U', 'speed-duel': 'Speed Duel' };
const formatLabel = (f) => FORMAT_LABELS[f] || f;

// Mensaje cuando una carta no se puede añadir por el límite del formato
function limitMessage(card) {
  const limit = copyLimit(game.key, deck.format, card);
  const status = statusFor(game.key, deck.format, card);
  if (limit === 0) return `${card.name}: ${status ? status.reason.toLowerCase() : 'no permitida'} en ${formatLabel(deck.format)}`;
  return `${card.name}: máximo ${limit} ${limit === 1 ? 'copia' : 'copias'} en un mazo ${formatLabel(deck.format)}${status ? ` (${status.reason.toLowerCase()})` : ''}`;
}

// Insignia de prohibida / limitada de cada resultado del buscador
const badgeFor = (card) => banBadge(statusFor(game.key, deck ? deck.format : game.formats[0], card));

// Vuelve a dibujar las insignias de los resultados (al cambiar de formato o cuando llegan las listas)
async function refreshBadges() {
  const items = [...els.resultList.querySelectorAll('.result-item')].filter((i) => i.refreshBadge);
  if (game.key === 'mtg') await ensureLegalities(items.map((i) => i._card));
  items.forEach((i) => i.refreshBadge());
}

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
// La zona Comandante solo existe en el formato Commander
const ZONE_FORMATS = { commander: ['commander'] };
const zonesFor = (format) => game.deckZones.filter((z) => !ZONE_FORMATS[z] || ZONE_FORMATS[z].includes(format));
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
  deckGrid: document.getElementById('deck-grid'),
  name: document.getElementById('deck-name'),
  format: document.getElementById('deck-format'),
  description: document.getElementById('deck-description'),
  zones: document.getElementById('zones'),
  hints: document.getElementById('hints'),
  transferBtn: document.getElementById('transfer-btn'),
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
  renderDeckGrid();
  if (!deck) return;

  els.name.value = deck.name;
  // Formato inexistente (p. ej. el antiguo "casual"): se usa el primero del juego
  if (!game.formats.includes(deck.format)) deck.format = game.formats[0];
  fixCommanderZone();
  els.format.value = deck.format;
  buildTargetZones();
  els.description.value = deck.description || '';
  els.deleteBtn.classList.toggle('hidden', !deck._id);
  renderZones();
  completeLabels(deck);
  // MTG: la legalidad de las cartas guardadas se consulta a Scryfall (para avisar de prohibidas)
  if (game.key === 'mtg') {
    const shown = deck;
    ensureLegalities(shown.cards).then(() => deck === shown && renderZones());
  }
}

// Cartas guardadas antes de existir el set / la variante (Ace, Dual): se completan en segundo plano y se repinta
async function completeLabels(target) {
  try {
    if (game.key === 'mtg') {
      const missing = target.cards.filter((c) => !c.setCode && /^[0-9a-f-]{36}$/i.test(c.cardId));
      if (!missing.length) return;
      const done = await completeForExport('mtg', missing);
      done.forEach((d, i) => { missing[i].setCode = d.setCode || missing[i].setCode; missing[i].number = d.number || missing[i].number; missing[i].altName = d.altName || missing[i].altName; });
    } else if (game.key === 'digimon') {
      const pending = target.cards.filter((c) => c.variant === undefined || c.variant === null);
      if (!pending.length) return;
      await digimonVariantsFor(pending.map((c) => c.cardId), (found) => {
        if (deck !== target) return;
        let changed = false;
        pending.forEach((c) => { if (found.has(c.cardId) && c.variant !== found.get(c.cardId)) { c.variant = found.get(c.cardId); changed = true; } });
        if (changed) renderZones();
      });
      return;
    } else return;
    if (deck === target) renderZones();
  } catch (err) {
    // son solo etiquetas: si falla, se queda el nombre sin set
  }
}

function newDeck() {
  if (dirty && !window.confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
  els.picker.value = '';
  showEditor({ name: 'Mazo nuevo', format: game.formats[0], description: '', cards: [] });
  els.name.focus();
  els.name.select();
}

// ---------- Mazos disponibles (cuando no hay ninguno abierto) ----------
// Imagen de cada mazo: su carta insignia (★) o, si no tiene, la primera carta
function deckTile(d) {
  const cover = d.cover || d.firstCard || null;
  const src = cover ? betterImageUrl(safeImageUrl(cover.imageUrl)) : '';
  const box = el('div', { class: 'thumb' });
  if (src) {
    const img = el('img', { src, alt: cover.name, loading: 'lazy', referrerpolicy: 'no-referrer' });
    withImageFallback(img, () => { img.remove(); box.textContent = d.name; });
    box.append(img);
  } else {
    box.textContent = d.name;
  }
  const open = () => { els.picker.value = d._id; openDeck(d._id); };
  return el(
    'article',
    { class: 'tcg-card deck-tile', tabindex: '0', role: 'button', 'aria-label': `Abrir el mazo ${d.name}`, onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    box,
    el('div', { class: 'info' }, el('div', { class: 'name', text: d.name }), el('div', { class: 'meta', text: [formatLabel(d.format), `${d.cardCount || 0} cartas`].filter(Boolean).join(' · ') }))
  );
}

function renderDeckGrid() {
  const show = !deck;
  els.deckGrid.classList.toggle('hidden', !show || decks.length === 0);
  els.emptyState.classList.toggle('hidden', !show || decks.length > 0);
  clear(els.deckGrid);
  if (show) decks.forEach((d) => els.deckGrid.append(deckTile(d)));
}

// ---------- Cartas del mazo ----------
function renderZones() {
  clear(els.zones);
  const totals = {};

  zonesFor(deck.format).forEach((zone) => {
    const inZone = deck.cards.filter((c) => c.zone === zone);
    totals[zone] = inZone.reduce((sum, c) => sum + c.quantity, 0);

    const list = el('div', {});
    if (inZone.length === 0) list.append(el('div', { class: 'muted', text: 'Vacío' }));

    inZone
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((card) => {
        const minus = el('button', { type: 'button', text: '−', 'aria-label': 'Quitar una copia', onClick: () => changeQty(card, -1) });
        const isCover = Boolean(deck.cover && deck.cover.cardId === card.cardId);
        const star = el('button', {
          type: 'button',
          class: `star-btn${isCover ? ' on' : ''}`,
          text: isCover ? '★' : '☆',
          title: isCover ? 'Es la carta insignia del mazo (clic para quitarla)' : 'Usar como carta insignia del mazo',
          'aria-label': isCover ? 'Quitar carta insignia' : 'Marcar como carta insignia',
          'aria-pressed': String(isCover),
          onClick: () => setCover(isCover ? null : card),
        });
        list.append(
          el(
            'div',
            { class: 'deck-row' },
            markPreviewable(el('span', { class: 'deck-name' }, displayName(card, game.key), langBadge(card.language)), card),
            el('span', { class: 'ban-slot' }, badgeFor(card)), // prohibida / limitada, a la izquierda del selector de copias
            el(
              'span',
              { class: 'qty' },
              minus,
              el('span', { text: `x${card.quantity}` }),
              el('button', { type: 'button', text: '+', 'aria-label': 'Añadir una copia', disabled: copiesLeft(game.key, deck.format, deck.cards, card) < 1, title: copiesLeft(game.key, deck.format, deck.cards, card) < 1 ? `Límite de copias alcanzado (${copyLimit(game.key, deck.format, card)})` : '', onClick: () => changeQty(card, 1) })
            ),
            star,
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
  overLimit(game.key, deck.format, deck.cards).forEach((x) =>
    hints.push(x.limit === 0 ? `${x.name}: no permitida en ${formatLabel(deck.format)} (prohibida o fuera de las rarezas del formato).` : `${x.name}: ${x.count} copias (máximo ${x.limit} en ${formatLabel(deck.format)}).`)
  );
  bannedPairsIn(game.key, deck.cards).forEach((p) => hints.push(`Pareja prohibida en el mismo mazo: ${p}.`));
  if (hints.length) {
    const ul = el('ul', { class: 'hint-list' });
    hints.forEach((h) => ul.append(el('li', { text: h })));
    els.hints.append(ul);
  }
}

function addCardToDeck(card, zoneOverride) {
  if (!deck) return toast('Crea o selecciona un mazo primero', 'error');

  const wanted = zoneOverride && zoneOverride !== 'auto' ? zoneOverride : card.zoneHint || 'main';
  const zone = zonesFor(deck.format).includes(wanted) ? wanted : 'main';

  // Límite de copias según el TCG y el formato (cuenta todas las zonas)
  if (copiesLeft(game.key, deck.format, deck.cards, card) < 1) {
    return toast(limitMessage(card), 'error');
  }

  const existing = deck.cards.find((c) => c.cardId === card.cardId && c.zone === zone);
  if (existing) {
    existing.quantity = Math.min(99, existing.quantity + 1);
  } else {
    deck.cards.push({
      cardId: card.cardId,
      name: card.name,
      altName: card.altName || '',
      variant: card.variant || '',
      setCode: card.setCode || '',
      number: card.number || '',
      imageUrl: card.imageUrl || '',
      imageBack: card.imageBack || '',
      backKind: card.backKind || '',
      language: card.language || catalogLang,
      quantity: 1,
      zone,
    });
  }
  markDirty();
  renderZones();
}

function changeQty(card, delta) {
  if (delta > 0 && copiesLeft(game.key, deck.format, deck.cards, card) < delta) {
    return toast(limitMessage(card), 'error');
  }
  card.quantity += delta;
  if (card.quantity <= 0) return removeCard(card);
  card.quantity = Math.min(99, card.quantity);
  markDirty();
  renderZones();
}

function setCover(card) {
  deck.cover = card ? { cardId: card.cardId, name: card.name, imageUrl: card.imageUrl || '', imageBack: card.imageBack || '', backKind: card.backKind || '' } : null;
  markDirty();
  renderZones();
}

function removeCard(card) {
  deck.cards = deck.cards.filter((c) => c !== card);
  if (deck.cover && !deck.cards.some((c) => c.cardId === deck.cover.cardId)) deck.cover = null;
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
    cover: deck.cover || null,
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
    renderBadge: badgeFor,
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
      resultItem(r, el('button', { class: 'btn btn-sm', type: 'button', text: '+ Mazo', onClick: () => addCardToDeck(r, els.targetZone.value) }), badgeFor)
    );
  });
  refreshBadges();
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

// ---------- Importar / exportar ----------
function currentDeckForExport() {
  if (!deck) return null;
  return { name: els.name.value.trim() || deck.name, format: els.format.value, description: els.description.value.trim(), cards: deck.cards };
}

async function importDeck({ cards, name, deckFormat, description, onProgress }) {
  const format = deckFormat || game.formats[0];
  const merged = [];
  let trimmed = 0;
  for (const c of cards) {
    const zone = zonesFor(format).includes(c.zone) ? c.zone : 'main';
    // El límite de copias del formato se respeta también al importar (cuenta todas las zonas)
    const room = copiesLeft(game.key, format, merged, c);
    const qty = Math.min(99, c.quantity, room);
    trimmed += Math.min(99, c.quantity) - qty;
    if (qty < 1) continue;
    const same = merged.find((m) => m.cardId === c.cardId && m.zone === zone);
    if (same) same.quantity += qty;
    else {
      merged.push({
        cardId: c.cardId, name: c.name, altName: c.altName || '', variant: c.variant || '', setCode: c.setCode || '', number: c.number || '',
        imageUrl: c.imageUrl || '', imageBack: c.imageBack || '', backKind: c.backKind || '',
        language: c.language || 'en', quantity: qty, zone,
      });
    }
  }
  onProgress(0, 1);
  const { deck: saved } = await api.post('/decks', { game: game.key, name, format, description, cards: merged });
  dirty = false;
  await loadDecks(saved._id);
  showEditor(saved);
  return `Mazo "${saved.name}" importado${trimmed ? ` (${trimmed} copias omitidas por el límite del formato)` : ''}`;
}

els.transferBtn.addEventListener('click', () => {
  if (dirty && !window.confirm('Tienes cambios sin guardar en el mazo abierto; al importar se abrirá el mazo nuevo y se descartarán. ¿Continuar?')) return;
  openTransferDialog({
    kind: 'deck',
    gameKey: game.key,
    deckFormats: game.formats,
    getExport: currentDeckForExport,
    onImport: importDeck,
  });
});

// ---------- Mano inicial ----------
document.getElementById('hand-btn').addEventListener('click', () => {
  const current = currentDeckForExport();
  if (!current || !current.cards.some((c) => c.zone === 'main')) return toast('Añade cartas a la zona principal del mazo para simular una mano', 'error');
  openHandSimulator({ gameKey: game.key, deck: current });
});

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
// Fuera de Commander no hay zona Comandante: sus cartas pasan al mazo principal
function fixCommanderZone() {
  if (zonesFor(deck.format).includes('commander')) return false;
  const moved = deck.cards.filter((c) => c.zone === 'commander');
  moved.forEach((c) => {
    const same = deck.cards.find((x) => x !== c && x.cardId === c.cardId && x.zone === 'main');
    if (same) { same.quantity = Math.min(99, same.quantity + c.quantity); deck.cards = deck.cards.filter((x) => x !== c); } else c.zone = 'main';
  });
  return moved.length > 0;
}

// Zonas de destino disponibles para el formato actual
function buildTargetZones() {
  const prev = els.targetZone.value;
  clear(els.targetZone);
  els.targetZone.append(el('option', { value: 'auto', text: 'Zona: automática' }));
  zonesFor(deck ? deck.format : game.formats[0]).forEach((z) => els.targetZone.append(el('option', { value: z, text: ZONE_LABELS[z] || z })));
  els.targetZone.value = [...els.targetZone.options].some((o) => o.value === prev) ? prev : 'auto';
}

els.format.addEventListener('change', () => {
  if (!deck) return;
  deck.format = els.format.value;
  refreshBadges();
  if (fixCommanderZone()) toast('Las cartas del Comandante pasan al mazo principal', 'info');
  buildTargetZones();
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
  [, game] = await Promise.all([requireSession(), loadGame()]);

  document.getElementById('game-name').textContent = game.name;
  const key = encodeURIComponent(game.key);
  document.getElementById('nav-collection').href = `/collection?game=${key}`;
  document.getElementById('nav-decks').href = `/deck-builder?game=${key}`;

  // Formatos y zonas de destino según el TCG
  game.formats.forEach((f) => els.format.append(el('option', { value: f, text: formatLabel(f) })));
  buildTargetZones();

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
  // Listas de prohibidas / limitadas (actualizadas automáticamente); al llegar se redibuja lo que dependa de ellas
  loadBanlists().then(() => {
    if (deck) renderZones();
    refreshBadges();
  });

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
