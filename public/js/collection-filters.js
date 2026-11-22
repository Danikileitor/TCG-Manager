// Filtros y orden para "Mi colección". Todo se hace en el navegador sobre las cartas ya cargadas.
// Las opciones del panel salen de lo que el usuario tiene (solo se ofrecen colores, tipos, ediciones…
// que existan en su colección). Reutiliza los controles del buscador del catálogo.
import { MAKERS, isEmptyValue, describeValue, filterIcon, closeIcon, nextId } from './catalog-search.js';
import { langShort } from './language.js';
import { el, clear } from './ui.js';

const MTG_COLOR_INFO = {
  W: ['Blanco', '#f3e9b5'], U: ['Azul', '#4a90d9'], B: ['Negro', '#5a4a5e'], R: ['Rojo', '#e0533f'], G: ['Verde', '#3f9b5c'], C: ['Incoloro', '#aab2bd'],
};
const DIGIMON_COLOR_INFO = {
  Red: ['Rojo', '#e0533f'], Blue: ['Azul', '#4a90d9'], Yellow: ['Amarillo', '#e6c84a'], Green: ['Verde', '#3f9b5c'],
  Black: ['Negro', '#5a4a5e'], Purple: ['Morado', '#8e5fc0'], White: ['Blanco', '#f3e9b5'],
};
const MTG_TYPE_ES = {
  Creature: 'Criatura', Instant: 'Instantáneo', Sorcery: 'Conjuro', Artifact: 'Artefacto', Enchantment: 'Encantamiento',
  Land: 'Tierra', Planeswalker: 'Planeswalker', Battle: 'Batalla', Legendary: 'Legendaria', Basic: 'Básica', Snow: 'Nevada',
  Tribal: 'Tribal', Token: 'Ficha',
};
const CONDITION_LABELS = { M: 'Mint', NM: 'Casi nueva', EX: 'Excelente', GD: 'Buena', LP: 'Poco usada', PL: 'Usada', PO: 'Mala' };
const FINISH_LABELS = { normal: 'Normal', foil: 'Foil', etched: 'Etched', '1st': '1.ª edición', unlimited: 'Unlimited', limited: 'Limited' };
const RARITY_LABELS = { common: 'Común', uncommon: 'Poco común', rare: 'Rara', mythic: 'Mítica', special: 'Especial', bonus: 'Bonus' };
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus', 'C', 'U', 'R', 'SR', 'SEC', 'P'];

// Nombres de los campos numéricos según el juego
const NUMBER_LABELS = {
  mtg: { cost: 'Coste de maná', power: 'Fuerza' },
  ygo: { level: 'Nivel / Rango / Enlace', power: 'ATK' },
  digimon: { cost: 'Coste de jugada', level: 'Nivel', power: 'DP' },
};

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uniqSorted = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
const facet = (card, key) => (card.facets ? card.facets[key] : undefined);

export const SORTS = [
  { value: 'name', label: 'Nombre (A–Z)' },
  { value: 'recent', label: 'Añadidas recientemente' },
  { value: 'qty', label: 'Más copias primero' },
  { value: 'cost', label: 'Coste / nivel (menor primero)' },
  { value: 'set', label: 'Edición' },
];

// Esquema de filtros que se ofrece según las cartas del usuario
export function buildSchema(gameKey, cards) {
  const labels = NUMBER_LABELS[gameKey] || {};
  const hasFacets = cards.some((c) => c.facets);
  const groups = [];

  if (hasFacets) {
    const fields = [];
    const colors = uniqSorted(cards.flatMap((c) => facet(c, 'colors') || []));
    if (colors.length) {
      const info = gameKey === 'mtg' ? MTG_COLOR_INFO : DIGIMON_COLOR_INFO;
      const order = Object.keys(info);
      colors.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
      fields.push({
        id: 'colors', label: 'Color', type: 'chips',
        options: colors.map((v) => ({ value: v, label: (info[v] || [v])[0], swatch: (info[v] || [])[1] })),
      });
      fields.push({
        id: 'colorMode', label: 'Combinar colores', type: 'select', noEmpty: true, modifier: true,
        options: [{ value: 'any', label: 'Cualquiera de los elegidos' }, { value: 'all', label: 'Todos los elegidos' }, { value: 'exact', label: 'Solo esos colores' }],
      });
    }
    const types = uniqSorted(cards.flatMap((c) => facet(c, 'types') || []));
    if (types.length) {
      fields.push({
        id: 'types', label: 'Tipo (deben tenerse todos)', type: 'chips',
        options: types.map((v) => ({ value: v, label: (gameKey === 'mtg' && MTG_TYPE_ES[v]) || v })),
      });
    }
    const attrs = uniqSorted(cards.map((c) => facet(c, 'attribute')));
    if (attrs.length) fields.push({ id: 'attribute', label: 'Atributo', type: 'chips', options: attrs.map((v) => ({ value: v, label: v })) });
    const subtypes = uniqSorted(cards.flatMap((c) => facet(c, 'subtypes') || []));
    if (subtypes.length) fields.push({ id: 'subtypes', label: 'Subtipo / raza / rasgo', type: 'text', suggestions: subtypes.slice(0, 400), placeholder: 'Escribe para filtrar…' });
    for (const key of ['cost', 'level', 'power']) {
      if (labels[key] && cards.some((c) => typeof facet(c, key) === 'number')) fields.push({ id: key, label: labels[key], type: 'range', min: 0, placeholder: 'Valor' });
    }
    if (fields.length) groups.push({ title: 'Datos de la carta', fields });
  }

  const mine = [];
  const langs = uniqSorted(cards.map((c) => c.language));
  if (langs.length > 1) mine.push({ id: 'language', label: 'Idioma', type: 'chips', options: langs.map((v) => ({ value: v, label: langShort(v) })) });
  const sets = uniqSorted(cards.map((c) => c.setCode));
  if (sets.length > 1) mine.push({ id: 'set', label: 'Edición', type: 'select', options: sets.map((v) => ({ value: v, label: v })) });
  const rarities = uniqSorted(cards.map((c) => c.rarity)).sort((a, b) => (RARITY_ORDER.indexOf(a) + 1 || 99) - (RARITY_ORDER.indexOf(b) + 1 || 99));
  if (rarities.length > 1) mine.push({ id: 'rarity', label: 'Rareza', type: 'chips', options: rarities.map((v) => ({ value: v, label: RARITY_LABELS[v] || v })) });
  const conds = uniqSorted(cards.map((c) => c.condition));
  if (conds.length > 1) mine.push({ id: 'condition', label: 'Estado', type: 'chips', options: conds.map((v) => ({ value: v, label: CONDITION_LABELS[v] || v })) });
  const finishes = uniqSorted(cards.map((c) => c.finish));
  if (finishes.length > 1) mine.push({ id: 'finish', label: 'Acabado', type: 'chips', options: finishes.map((v) => ({ value: v, label: FINISH_LABELS[v] || v })) });
  mine.push({ id: 'quantity', label: 'Copias', type: 'range', min: 1, placeholder: 'Copias' });
  groups.push({ title: 'En mi colección', fields: mine });
  return groups;
}

const inRange = (value, r) => {
  if (typeof value !== 'number') return false;
  const lo = r.min === '' || r.min === undefined ? null : Number(r.min);
  const hi = r.max === '' || r.max === undefined ? null : Number(r.max);
  return (lo === null || value >= lo) && (hi === null || value <= hi);
};

// ¿Cumple la carta los filtros aplicados? (values: { idCampo: valor })
export function matchesFilters(card, values) {
  for (const [id, v] of Object.entries(values)) {
    switch (id) {
      case 'colors': {
        const have = facet(card, 'colors');
        if (!have) return false;
        const mode = values.colorMode || 'any';
        if (mode === 'any' && !v.some((c) => have.includes(c))) return false;
        if (mode === 'all' && !v.every((c) => have.includes(c))) return false;
        if (mode === 'exact' && !(v.length === have.length && v.every((c) => have.includes(c)))) return false;
        break;
      }
      case 'types': {
        const have = facet(card, 'types');
        if (!have || !v.every((t) => have.includes(t))) return false;
        break;
      }
      case 'attribute':
        if (!v.includes(facet(card, 'attribute'))) return false;
        break;
      case 'subtypes': {
        const have = facet(card, 'subtypes');
        if (!have || !have.some((s) => norm(s).includes(norm(v)))) return false;
        break;
      }
      case 'cost': case 'level': case 'power':
        if (!inRange(facet(card, id), v)) return false;
        break;
      case 'quantity':
        if (!inRange(card.quantity, v)) return false;
        break;
      case 'language': case 'rarity': case 'condition': case 'finish':
        if (!v.includes(card[id])) return false;
        break;
      case 'set':
        if (card.setCode !== v) return false;
        break;
      default:
        break; // colorMode y otros modificadores
    }
  }
  return true;
}

export function sortCards(list, mode) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'es');
  const arr = [...list];
  if (mode === 'recent') arr.sort((a, b) => String(b.acquiredAt || '').localeCompare(String(a.acquiredAt || '')) || byName(a, b));
  else if (mode === 'qty') arr.sort((a, b) => b.quantity - a.quantity || byName(a, b));
  else if (mode === 'cost') {
    const cost = (c) => (typeof facet(c, 'cost') === 'number' ? facet(c, 'cost') : typeof facet(c, 'level') === 'number' ? facet(c, 'level') : 9999);
    arr.sort((a, b) => cost(a) - cost(b) || byName(a, b));
  } else if (mode === 'set') arr.sort((a, b) => String(a.setCode).localeCompare(String(b.setCode)) || byName(a, b));
  else arr.sort(byName);
  return arr;
}

export function matchesName(card, text) {
  const q = norm(text);
  if (!q) return true;
  return q.split(/\s+/).every((t) => norm(card.name).includes(t) || norm(card.altName || '').includes(t));
}

// Panel de filtros (diálogo lateral, como el del catálogo) + etiquetas de filtros activos.
// getCards(): cartas actuales. onChange(): se llama al aplicar o quitar filtros.
export function createCollectionFilters({ gameKey, mount, getCards, onChange }) {
  let applied = {};
  let controls = new Map();
  let fields = [];

  const countBadge = el('span', { class: 'cs-count hidden', 'aria-hidden': 'true' });
  const filtersBtn = el('button', { class: 'btn btn-ghost btn-sm cs-filters-btn', type: 'button', 'aria-haspopup': 'dialog' }, filterIcon(), 'Filtros', countBadge);
  const activeBox = el('div', { class: 'cs-active hidden', 'aria-label': 'Filtros activos' });
  const body = el('div', { class: 'cs-drawer-body' });
  const titleId = nextId('cf-title');
  const closeBtn = el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'Cerrar filtros' }, closeIcon());
  const clearBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Limpiar' });
  const applyBtn = el('button', { class: 'btn', type: 'submit', text: 'Aplicar filtros' });
  const form = el(
    'form', { class: 'cs-drawer-form', novalidate: true },
    el('header', { class: 'cs-drawer-head' }, el('h3', { id: titleId, text: 'Filtros de mi colección' }), closeBtn),
    body,
    el('footer', { class: 'cs-drawer-foot' }, clearBtn, applyBtn)
  );
  const dialog = el('dialog', { class: 'cs-drawer', 'aria-labelledby': titleId }, form);
  mount.append(filtersBtn);
  document.body.append(dialog);

  const schema = () => buildSchema(gameKey, getCards());
  const countable = (id) => id !== 'colorMode';
  const activeIds = () => Object.keys(applied).filter(countable);

  function buildControls() {
    clear(body);
    controls = new Map();
    const groups = schema();
    fields = groups.flatMap((g) => g.fields);
    groups.forEach((group) => {
      const fieldset = el('fieldset', { class: 'cs-group' }, el('legend', { text: group.title }));
      group.fields.forEach((f) => {
        const control = MAKERS[f.type](f, { getLang: () => 'es' });
        controls.set(f.id, control);
        fieldset.append(control.node);
      });
      body.append(fieldset);
    });
  }

  function renderActive() {
    clear(activeBox);
    const ids = activeIds();
    countBadge.textContent = String(ids.length);
    countBadge.classList.toggle('hidden', ids.length === 0);
    activeBox.classList.toggle('hidden', ids.length === 0);
    if (!ids.length) return;
    const all = schema().flatMap((g) => g.fields);
    ids.forEach((id) => {
      const f = all.find((x) => x.id === id);
      if (!f) return;
      const text = `${f.label.replace(' (deben tenerse todos)', '')}: ${describeValue(f, applied[id], { label: String })}`;
      activeBox.append(
        el('button', {
          class: 'cs-tag', type: 'button', title: 'Quitar este filtro', 'aria-label': `Quitar filtro ${text}`,
          onClick: () => {
            delete applied[id];
            if (id === 'colors') delete applied.colorMode;
            renderActive();
            onChange();
          },
        }, el('span', { text }), closeIcon())
      );
    });
    activeBox.append(el('button', { class: 'cs-clear-all', type: 'button', text: 'Quitar todos', onClick: () => { applied = {}; renderActive(); onChange(); } }));
  }

  function open() {
    buildControls();
    for (const f of fields) controls.get(f.id).write(applied[f.id]);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  const close = () => (typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open'));

  filtersBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('click', (e) => e.target === dialog && close());
  clearBtn.addEventListener('click', () => fields.forEach((f) => controls.get(f.id).write(undefined)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const draft = {};
    for (const f of fields) {
      const value = controls.get(f.id).read();
      if (!isEmptyValue(f, value)) draft[f.id] = value;
    }
    if (!draft.colors) delete draft.colorMode;
    applied = draft;
    renderActive();
    close();
    onChange();
  });

  return {
    activeBox,
    get values() { return applied; },
    hasActive: () => activeIds().length > 0,
    // Hay que llamarlo si cambian las cartas: quita filtros de valores que ya no existen y repinta
    refresh: renderActive,
    // ¿Algún filtro depende de los datos de la carta (facets)?
    usesFacets: () => ['colors', 'types', 'attribute', 'subtypes', 'cost', 'level', 'power'].some((k) => applied[k] !== undefined),
  };
}
