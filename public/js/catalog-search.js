// Buscador de catálogo reutilizable (colección y constructor de mazos).
//
// Dibuja, dentro de `mount`:
//   - la caja de búsqueda por nombre
//   - el botón "Filtros" (abre un panel lateral con los filtros propios del TCG)
//   - el interruptor "Incluir artes alternativos"
//   - los filtros activos como etiquetas que se pueden quitar una a una
// y gestiona la lista de resultados (resumen, "Cargar más", errores).
//
// Los filtros de cada TCG vienen de card-providers.js (getFilterSchema).
// Todo el DOM se construye con textContent (nunca innerHTML con datos externos).
import { getFilterSchema, getAltArtsInfo } from './card-providers.js';
import { langShort } from './language.js';
import { el, clear, toast } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(paths, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  paths.forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

const filterIcon = () => icon(['M3 5h18', 'M6 12h12', 'M10 19h4']);
const closeIcon = () => icon(['M6 6l12 12', 'M18 6L6 18'], 14);
const checkIcon = () => icon(['M5 12.5l4.5 4.5L19 7.5'], 14);

// ---------- Controles de cada tipo de filtro ----------
// Cada control devuelve { node, read(), write(valor) }
let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

function fieldWrap(field, control, labelFor) {
  const wrap = el('div', { class: 'cs-field' });
  if (labelFor) wrap.append(el('label', { class: 'cs-label', for: labelFor, text: field.label }));
  else wrap.append(el('span', { class: 'cs-label', text: field.label }));
  wrap.append(control);
  if (field.hint) wrap.append(el('small', { class: 'muted', text: field.hint }));
  return wrap;
}

function makeSelect(field) {
  const id = nextId('f');
  const select = el('select', { id });
  if (!field.noEmpty) select.append(el('option', { value: '', text: 'Cualquiera' }));
  field.options.forEach((o) => select.append(el('option', { value: o.value, text: o.label })));
  return {
    node: fieldWrap(field, select, id),
    read: () => select.value,
    write: (v) => {
      select.value = v === undefined || v === null ? (field.noEmpty ? field.options[0].value : '') : v;
    },
  };
}

function makeChips(field) {
  const group = el('div', { class: 'cs-chips', role: 'group', 'aria-label': field.label });
  const boxes = field.options.map((o) => {
    const input = el('input', { type: 'checkbox', value: o.value });
    const label = el(
      'label',
      { class: 'cs-chip' },
      input,
      el('span', { class: 'cs-chip-face' }, o.swatch ? el('i', { class: 'cs-swatch', style: `background:${o.swatch}`, 'aria-hidden': 'true' }) : null, o.label)
    );
    group.append(label);
    return input;
  });
  return {
    node: fieldWrap(field, group),
    read: () => boxes.filter((b) => b.checked).map((b) => b.value),
    write: (v) => boxes.forEach((b) => (b.checked = Array.isArray(v) && v.includes(b.value))),
  };
}

function makeRange(field) {
  const minId = nextId('f');
  const maxId = nextId('f');
  const attrs = { type: 'number', inputmode: 'numeric', min: field.min, max: field.max, step: field.step || 1 };
  const min = el('input', { ...attrs, id: minId, placeholder: 'Mín.', 'aria-label': `${field.label}: mínimo` });
  const max = el('input', { ...attrs, id: maxId, placeholder: 'Máx.', 'aria-label': `${field.label}: máximo` });
  const row = el('div', { class: 'cs-range' }, min, el('span', { class: 'cs-range-sep', text: '–', 'aria-hidden': 'true' }), max);
  return {
    node: fieldWrap(field, row),
    read: () => ({ min: min.value, max: max.value }),
    write: (v) => {
      min.value = (v && v.min) ?? '';
      max.value = (v && v.max) ?? '';
    },
  };
}

function makeNumber(field) {
  const id = nextId('f');
  const input = el('input', { id, type: 'number', inputmode: 'numeric', min: field.min, max: field.max, step: field.step || 1, placeholder: field.placeholder || '' });
  return { node: fieldWrap(field, input, id), read: () => input.value, write: (v) => (input.value = v ?? '') };
}

function makeText(field) {
  const id = nextId('f');
  const input = el('input', { id, type: 'text', maxlength: 80, autocomplete: 'off', placeholder: field.placeholder || '' });
  const wrap = fieldWrap(field, input, id);
  if (field.suggestions) {
    const listId = nextId('dl');
    input.setAttribute('list', listId);
    const list = el('datalist', { id: listId });
    field.suggestions.forEach((s) => list.append(el('option', { value: s })));
    wrap.append(list);
  }
  return { node: wrap, read: () => input.value.trim(), write: (v) => (input.value = v ?? '') };
}

// Lista desplegable con búsqueda (las opciones se cargan al abrir los filtros)
function makeCombo(field) {
  const id = nextId('f');
  const listId = nextId('dl');
  const input = el('input', { id, type: 'text', maxlength: 80, autocomplete: 'off', list: listId, placeholder: field.placeholder || '' });
  const list = el('datalist', { id: listId });
  let options = [];
  let loading = null;

  const byLabel = (text) => {
    const t = text.trim().toLowerCase();
    return options.find((o) => o.label.toLowerCase() === t) || null;
  };
  const control = {
    node: fieldWrap(field, el('div', {}, input, list), id),
    read: () => {
      const text = input.value.trim();
      if (!text) return '';
      const exact = byLabel(text);
      if (exact) return exact.value;
      // Un código escrito a mano ("znr") o una opción única que contiene el texto
      const matches = options.filter((o) => o.label.toLowerCase().includes(text.toLowerCase()));
      return matches.length === 1 ? matches[0].value : text;
    },
    write: (v) => {
      const found = options.find((o) => o.value === v);
      input.value = found ? found.label : v ?? '';
    },
    label: (v) => {
      const found = options.find((o) => o.value === v);
      return found ? found.label : v;
    },
    load() {
      if (!loading) {
        loading = Promise.resolve(field.loadOptions())
          .then((opts) => {
            options = opts;
            const frag = document.createDocumentFragment();
            opts.forEach((o) => frag.append(el('option', { value: o.label })));
            list.append(frag);
          })
          .catch(() => {
            loading = null; // sin lista: se puede escribir el código a mano y se reintenta al reabrir
          });
      }
      return loading;
    },
  };
  return control;
}

const MAKERS = { select: makeSelect, chips: makeChips, range: makeRange, number: makeNumber, text: makeText, combo: makeCombo };

// ---------- Descripción de los filtros activos ----------
function isEmptyValue(field, value) {
  if (field.type === 'chips') return !Array.isArray(value) || value.length === 0;
  if (field.type === 'range') return !value || (String(value.min ?? '') === '' && String(value.max ?? '') === '');
  return value === undefined || value === null || String(value).trim() === '';
}

function describeValue(field, value, control) {
  if (field.type === 'chips') {
    return value.map((v) => (field.options.find((o) => o.value === v) || { label: v }).label).join(', ');
  }
  if (field.type === 'select') return (field.options.find((o) => o.value === value) || { label: value }).label;
  if (field.type === 'range') {
    const min = String(value.min ?? '');
    const max = String(value.max ?? '');
    if (min && max) return min === max ? min : `${min}–${max}`;
    return min ? `≥ ${min}` : `≤ ${max}`;
  }
  if (field.type === 'combo') return control.label(value);
  return String(value);
}

// Etiqueta con el idioma de una carta (ES, EN, FR...)
export function langBadge(code) {
  return code ? el('span', { class: 'lang-badge', text: langShort(code) }) : null;
}

// Fila de un resultado del catálogo; `action` es el botón de la derecha
export function resultItem(card, action) {
  let thumb = card.imageUrl
    ? el('img', { src: card.imageUrl, alt: card.name, loading: 'lazy', referrerpolicy: 'no-referrer' })
    : el('div', { class: 'ph' });
  // Si la imagen no carga (enlace roto), se muestra el hueco gris en su lugar
  if (thumb.tagName === 'IMG') {
    thumb.addEventListener('error', () => thumb.replaceWith(el('div', { class: 'ph' })), { once: true });
  }
  return el(
    'div',
    { class: 'result-item' },
    thumb,
    el(
      'div',
      {},
      el('div', { class: 'name' }, card.name, langBadge(card.language), card.isAlt ? el('span', { class: 'alt-badge', text: 'Arte alt.' }) : null),
      card.altName ? el('div', { class: 'meta', text: `EN: ${card.altName}` }) : null,
      el('div', { class: 'meta', text: [card.typeLine, card.setCode, card.rarity].filter(Boolean).join(' · ') }),
      card.statLine ? el('div', { class: 'meta', text: card.statLine }) : null
    ),
    action
  );
}

/**
 * @param {object} cfg
 * @param {string} cfg.gameKey
 * @param {HTMLElement} cfg.mount        donde se dibujan los controles de búsqueda
 * @param {HTMLElement} cfg.resultList   donde se dibujan los resultados
 * @param {(req) => Promise<{cards, hasMore, total}>} cfg.search  req = { query, filters, altArts, page }
 * @param {(card) => HTMLElement} cfg.renderAction  botón de cada resultado
 * @param {string} [cfg.idleMessage]
 */
export function createCatalogSearch({ gameKey, mount, resultList, search, renderAction, idleMessage = 'Busca una carta para añadirla.' }) {
  const schema = getFilterSchema(gameKey);
  const fields = schema.flatMap((g) => g.fields);
  const altInfo = getAltArtsInfo(gameKey);

  let applied = {}; // filtros aplicados: { idCampo: valor }
  let page = 1;
  let token = 0; // descarta respuestas antiguas
  let loadedCount = 0;
  let lastReq = null;

  // ----- Controles principales -----
  const input = el('input', { type: 'search', placeholder: 'Nombre de la carta…', 'aria-label': 'Nombre de la carta', autocomplete: 'off' });
  const submit = el('button', { class: 'btn', type: 'submit', text: 'Buscar' });
  const form = el('form', { class: 'cs-form', role: 'search' }, input, submit);

  const countBadge = el('span', { class: 'cs-count hidden', 'aria-hidden': 'true' });
  const filtersBtn = el('button', { class: 'btn btn-ghost btn-sm cs-filters-btn', type: 'button', 'aria-haspopup': 'dialog' }, filterIcon(), 'Filtros', countBadge);

  const altInput = el('input', { type: 'checkbox' });
  const altLabel = el(
    'label',
    { class: 'check' },
    altInput,
    el('span', { class: 'check-box' }, checkIcon()),
    el('span', { class: 'check-text' }, el('strong', { text: altInfo.label }), altInfo.hint ? el('small', { text: altInfo.hint }) : null)
  );

  const activeBox = el('div', { class: 'cs-active hidden', 'aria-label': 'Filtros activos' });
  const optionsRow = el('div', { class: 'cs-options' }, schema.length ? filtersBtn : null, altLabel);

  // ----- Panel de filtros (dialog) -----
  const controls = new Map();
  const body = el('div', { class: 'cs-drawer-body' });
  schema.forEach((group) => {
    const fieldset = el('fieldset', { class: 'cs-group' }, el('legend', { text: group.title }));
    group.fields.forEach((f) => {
      const control = MAKERS[f.type](f);
      controls.set(f.id, control);
      fieldset.append(control.node);
    });
    body.append(fieldset);
  });

  const titleId = nextId('cs-title');
  const closeBtn = el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'Cerrar filtros' }, closeIcon());
  const clearBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Limpiar' });
  const applyBtn = el('button', { class: 'btn', type: 'submit', text: 'Aplicar filtros' });
  const drawerForm = el(
    'form',
    { class: 'cs-drawer-form', novalidate: true },
    el('header', { class: 'cs-drawer-head' }, el('h3', { id: titleId, text: 'Filtros' }), closeBtn),
    body,
    el('footer', { class: 'cs-drawer-foot' }, clearBtn, applyBtn)
  );
  const dialog = el('dialog', { class: 'cs-drawer', 'aria-labelledby': titleId }, drawerForm);

  mount.append(form, optionsRow, activeBox, dialog);

  // ----- Estado de los filtros -----
  function readDraft() {
    const draft = {};
    for (const f of fields) {
      const value = controls.get(f.id).read();
      if (!isEmptyValue(f, value)) draft[f.id] = value;
    }
    return draft;
  }

  function writeDraft(values) {
    for (const f of fields) controls.get(f.id).write(values[f.id]);
  }

  // Los "modificadores" (p. ej. cómo combinar colores) no cuentan como filtro por sí solos
  const countable = (id) => !(fields.find((f) => f.id === id) || {}).modifier;
  const activeIds = () => Object.keys(applied).filter(countable);

  function renderActive() {
    clear(activeBox);
    const ids = activeIds();
    countBadge.textContent = String(ids.length);
    countBadge.classList.toggle('hidden', ids.length === 0);
    activeBox.classList.toggle('hidden', ids.length === 0);
    if (ids.length === 0) return;

    ids.forEach((id) => {
      const f = fields.find((x) => x.id === id);
      const text = `${f.label}: ${describeValue(f, applied[id], controls.get(id))}`;
      activeBox.append(
        el(
          'button',
          {
            class: 'cs-tag',
            type: 'button',
            title: 'Quitar este filtro',
            'aria-label': `Quitar filtro ${text}`,
            onClick: () => {
              delete applied[id];
              renderActive();
              runSearch();
            },
          },
          el('span', { text }),
          closeIcon()
        )
      );
    });
    activeBox.append(
      el('button', {
        class: 'cs-clear-all',
        type: 'button',
        text: 'Quitar todos',
        onClick: () => {
          applied = {};
          renderActive();
          runSearch();
        },
      })
    );
  }

  // ----- Panel: abrir / cerrar -----
  function openDrawer() {
    writeDraft(applied);
    // Las listas largas (ediciones) se cargan la primera vez que se abre el panel
    controls.forEach((c, id) => c.load && c.load().then(() => applied[id] !== undefined && c.write(applied[id])));
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDrawer() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  filtersBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  // Clic en el fondo oscuro (fuera del panel) cierra
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDrawer();
  });
  clearBtn.addEventListener('click', () => writeDraft({}));
  drawerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    applied = readDraft();
    // Los modificadores sueltos no se guardan si no hay filtro al que modifiquen
    renderActive();
    closeDrawer();
    runSearch();
  });

  // ----- Búsqueda y resultados -----
  const query = () => input.value.trim();
  const hasCriteria = () => query().length >= 2 || activeIds().length > 0;

  function showMessage(text, cls = 'empty') {
    clear(resultList);
    resultList.append(el('div', { class: cls, text }));
  }

  function renderCards(res, append) {
    if (!append) clear(resultList);
    const old = resultList.querySelector('.cs-more');
    if (old) old.remove();

    if (!append && res.cards.length === 0) {
      showMessage('Sin resultados. Prueba con menos filtros o con otra búsqueda.');
      return;
    }
    if (!append) {
      loadedCount = 0;
      resultList.append(el('div', { class: 'cs-summary', role: 'status', text: `${res.total} ${res.total === 1 ? 'resultado' : 'resultados'}` }));
    }
    res.cards.forEach((card) => resultList.append(resultItem(card, renderAction(card))));
    loadedCount += res.cards.length;

    if (res.hasMore) {
      resultList.append(
        el('button', { class: 'btn btn-ghost cs-more', type: 'button', text: 'Cargar más resultados', onClick: () => runSearch(true) })
      );
    }
  }

  async function runSearch(append = false) {
    if (!hasCriteria()) {
      if (!append) {
        token++;
        showMessage(query().length === 1 ? 'Escribe al menos 2 caracteres o aplica algún filtro.' : idleMessage);
      }
      return;
    }
    const mine = ++token;
    if (append) {
      page += 1;
      const more = resultList.querySelector('.cs-more');
      if (more) {
        more.disabled = true;
        more.textContent = 'Cargando…';
      }
    } else {
      page = 1;
      clear(resultList);
      resultList.append(el('div', { class: 'spinner' }));
      lastReq = { query: query(), filters: { ...applied }, altArts: altInput.checked };
    }
    try {
      const res = await search({ ...lastReq, page });
      if (mine !== token) return;
      renderCards(res, append);
    } catch (err) {
      if (mine !== token) return;
      if (append) {
        page -= 1;
        const more = resultList.querySelector('.cs-more');
        if (more) {
          more.disabled = false;
          more.textContent = 'Cargar más resultados';
        }
        toast(err.message, 'error');
      } else {
        showMessage(err.message);
      }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (query().length === 1) return toast('Escribe al menos 2 caracteres', 'error');
    runSearch();
  });
  altInput.addEventListener('change', () => hasCriteria() && runSearch());

  renderActive();
  showMessage(idleMessage);

  return {
    run: () => runSearch(),
    /** Vuelve a buscar solo si ya había una búsqueda (p. ej. al cambiar de idioma) */
    refresh: () => hasCriteria() && runSearch(),
    cancel: () => {
      token++;
    },
    showIdle: () => showMessage(idleMessage),
    reset: () => {
      applied = {};
      input.value = '';
      renderActive();
    },
  };
}
