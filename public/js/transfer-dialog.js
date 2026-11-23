// Diálogo "Importar / Exportar" compartido por la colección y el constructor de mazos.
import { el, clear, toast } from './ui.js';
import { COLLECTION_FORMATS, DECK_FORMATS, exportCollection, exportDeck, parseImport } from './transfer.js';
import { completeForExport, resolveEntries } from './card-providers.js';

function download(filename, mime, text) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const FORMAT_LABELS = { json: 'JSON de TCG Manager', csv: 'CSV', text: 'Lista de texto', ydk: 'YDK', ydke: 'Enlace ydke://', ids: 'Lista de números' };

// opciones:
//   kind: 'collection' | 'deck'
//   gameKey
//   getExport(onlyVisible) -> cartas (colección) o mazo { name, format, description, cards } (puede devolver null)
//   hasVisibleFilter(): true si hay filtros/búsqueda activos (solo colección)
//   onImport({ cards, replace?, name?, deckFormat?, description?, onProgress }) -> Promise<texto del resultado>
//   deckZones: zonas válidas (solo mazos)
export function openTransferDialog(opts) {
  const { kind, gameKey } = opts;
  const isDeck = kind === 'deck';
  const formats = (isDeck ? DECK_FORMATS : COLLECTION_FORMATS)[gameKey] || [];

  const dialog = el('dialog', { class: 'tr-dialog', 'aria-label': 'Importar y exportar' });
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', () => setTimeout(() => dialog.remove(), 0));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  // ------------------------------------------------ pestañas
  const tabExport = el('button', { type: 'button', class: 'active', text: 'Exportar', 'data-tab': 'export' });
  const tabImport = el('button', { type: 'button', text: 'Importar', 'data-tab': 'import' });
  const paneExport = el('div', { class: 'tr-pane' });
  const paneImport = el('div', { class: 'tr-pane hidden' });
  const show = (name) => {
    tabExport.classList.toggle('active', name === 'export');
    tabImport.classList.toggle('active', name === 'import');
    paneExport.classList.toggle('hidden', name !== 'export');
    paneImport.classList.toggle('hidden', name !== 'import');
  };
  tabExport.addEventListener('click', () => show('export'));
  tabImport.addEventListener('click', () => show('import'));

  // ------------------------------------------------ exportar
  const fmtSelect = el('select', { id: 'tr-export-format', 'aria-label': 'Formato de exportación' });
  formats.forEach((f) => fmtSelect.append(el('option', { value: f.id, text: f.label })));
  const onlyVisible = el('input', { type: 'checkbox', id: 'tr-only-visible' });
  const onlyVisibleRow = el('label', { class: 'check tr-visible' }, onlyVisible, ' Solo las cartas que se ven con la búsqueda y los filtros actuales');
  if (isDeck || !(opts.hasVisibleFilter && opts.hasVisibleFilter())) onlyVisibleRow.classList.add('hidden');
  const preview = el('textarea', { id: 'tr-export-text', class: 'tr-text', readonly: true, rows: 10, spellcheck: 'false' });
  const exportInfo = el('div', { class: 'muted tr-info', role: 'status' });
  const downloadBtn = el('button', { type: 'button', class: 'btn', id: 'tr-download', text: 'Descargar archivo' });
  const copyBtn = el('button', { type: 'button', class: 'btn btn-ghost', id: 'tr-copy', text: 'Copiar al portapapeles' });
  let current = null;
  let token = 0;

  async function refreshExport() {
    const mine = ++token;
    current = null;
    downloadBtn.disabled = copyBtn.disabled = true;
    preview.value = '';
    const data = opts.getExport(onlyVisible.checked);
    const list = isDeck ? data && data.cards : data;
    if (!list || !list.length) {
      exportInfo.textContent = isDeck ? 'El mazo no tiene cartas.' : 'No hay cartas que exportar.';
      return;
    }
    exportInfo.textContent = 'Preparando…';
    let completed = list;
    try {
      completed = await completeForExport(gameKey, list, (d, t) => { if (mine === token) exportInfo.textContent = `Preparando… ${d}/${t}`; });
    } catch (err) {
      // se exporta con los datos que haya
    }
    if (mine !== token) return;
    try {
      current = isDeck ? exportDeck(fmtSelect.value, gameKey, { ...data, cards: completed }) : exportCollection(fmtSelect.value, gameKey, completed);
    } catch (err) {
      exportInfo.textContent = err.message;
      return;
    }
    preview.value = current.text;
    exportInfo.textContent = `${current.count} ${isDeck ? 'cartas' : 'cartas distintas'} · ${current.filename}`;
    downloadBtn.disabled = copyBtn.disabled = false;
  }
  fmtSelect.addEventListener('change', refreshExport);
  onlyVisible.addEventListener('change', refreshExport);
  downloadBtn.addEventListener('click', () => current && download(current.filename, current.mime, current.text));
  copyBtn.addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.text);
    } catch (err) {
      preview.select();
      document.execCommand('copy');
    }
    toast('Copiado', 'success');
  });
  paneExport.append(
    el('p', { class: 'muted', text: isDeck ? 'Exporta el mazo abierto para usarlo en otras webs y simuladores.' : 'Exporta tu colección de este juego.' }),
    el('div', { class: 'field' }, el('label', { for: 'tr-export-format', text: 'Formato' }), fmtSelect),
    onlyVisibleRow,
    preview,
    exportInfo,
    el('div', { class: 'toolbar' }, downloadBtn, copyBtn)
  );

  // ------------------------------------------------ importar
  const fileInput = el('input', { type: 'file', id: 'tr-file', accept: '.csv,.txt,.json,.ydk,.dec,text/*,application/json' });
  const pasteArea = el('textarea', { id: 'tr-import-text', class: 'tr-text', rows: 8, spellcheck: 'false', placeholder: isDeck ? 'O pega aquí el mazo (lista de texto, .ydk, ydke://, JSON…)' : 'O pega aquí la lista (CSV, texto o JSON)…' });
  const analyzeBtn = el('button', { type: 'button', class: 'btn', id: 'tr-analyze', text: 'Analizar' });
  const report = el('div', { class: 'tr-report', id: 'tr-report', role: 'status' });
  const nameInput = el('input', { type: 'text', id: 'tr-deck-name', maxlength: 100, placeholder: 'Nombre del mazo' });
  const fmtImport = el('select', { id: 'tr-deck-format', 'aria-label': 'Formato del mazo' });
  (opts.deckFormats || []).forEach((f) => fmtImport.append(el('option', { value: f, text: f })));
  const modeAdd = el('input', { type: 'radio', name: 'tr-mode', value: 'add', checked: true });
  const modeReplace = el('input', { type: 'radio', name: 'tr-mode', value: 'replace' });
  const importBtn = el('button', { type: 'button', class: 'btn', id: 'tr-import', text: 'Importar', disabled: true });
  const options = el('div', { class: 'tr-options hidden' });
  if (isDeck) {
    options.append(
      el('div', { class: 'field' }, el('label', { for: 'tr-deck-name', text: 'Nombre del mazo nuevo' }), nameInput),
      el('div', { class: 'field' }, el('label', { for: 'tr-deck-format', text: 'Formato' }), fmtImport),
      el('small', { class: 'muted', text: 'El mazo importado se crea como un mazo nuevo; los que ya tienes no se tocan.' })
    );
  } else {
    options.append(
      el('label', { class: 'check' }, modeAdd, ' Añadir a mi colección (suma las cantidades de las cartas que ya tengas)'),
      el('label', { class: 'check' }, modeReplace, ' Reemplazar mi colección de este juego por el contenido del archivo')
    );
  }

  let parsed = null; // { cards, missing, meta }

  async function analyze() {
    parsed = null;
    importBtn.disabled = true;
    options.classList.add('hidden');
    clear(report);
    const text = pasteArea.value;
    const res = parseImport(text, gameKey, kind);
    if (!res.entries.length) {
      report.append(el('p', { class: 'tr-error', text: res.warnings[0] || 'No se encontró ninguna carta.' }));
      return;
    }
    analyzeBtn.disabled = true;
    const status = el('p', { class: 'muted', text: `Formato detectado: ${FORMAT_LABELS[res.format] || res.format}. Buscando ${res.entries.length} cartas…` });
    report.append(status);
    try {
      const { cards, missing } = await resolveEntries(gameKey, res.entries, (d, t) => { status.textContent = `Buscando cartas… ${d}/${t}`; });
      parsed = { cards, missing, meta: res };
    } catch (err) {
      clear(report);
      report.append(el('p', { class: 'tr-error', text: err.message }));
      analyzeBtn.disabled = false;
      return;
    }
    analyzeBtn.disabled = false;
    renderReport();
  }

  function renderReport() {
    clear(report);
    const { cards, missing, meta } = parsed;
    const copies = cards.reduce((s, c) => s + c.quantity, 0);
    report.append(
      el('p', {}, el('strong', { text: `${cards.length} cartas distintas (${copies} copias)` }), ` reconocidas · formato ${FORMAT_LABELS[meta.format] || meta.format}`)
    );
    meta.warnings.forEach((w) => report.append(el('p', { class: 'muted', text: w })));
    if (missing.length) {
      const names = missing.slice(0, 40).map((m) => `${m.quantity} ${m.name || m.cardId || m.scryfallId}`);
      report.append(
        el('details', { class: 'tr-missing' }, el('summary', { text: `${missing.length} no se encontraron y se omitirán` }), el('pre', { text: names.join('\n') + (missing.length > 40 ? `\n… y ${missing.length - 40} más` : '') }))
      );
    }
    if (cards.length) {
      if (isDeck) {
        nameInput.value = meta.name || nameInput.value || 'Mazo importado';
        const wanted = meta.deckFormat;
        if (wanted && [...fmtImport.options].some((o) => o.value === wanted)) fmtImport.value = wanted;
        if (cards.some((c) => c.zone === 'commander') && [...fmtImport.options].some((o) => o.value === 'commander')) fmtImport.value = 'commander';
      }
      options.classList.remove('hidden');
      importBtn.disabled = false;
    }
  }

  async function readFile() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('El archivo es demasiado grande (máximo 5 MB)', 'error');
    pasteArea.value = await file.text();
    if (isDeck && !nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '');
    analyze();
  }
  fileInput.addEventListener('change', readFile);
  analyzeBtn.addEventListener('click', analyze);
  pasteArea.addEventListener('input', () => { importBtn.disabled = true; parsed = null; });

  importBtn.addEventListener('click', async () => {
    if (!parsed || !parsed.cards.length) return;
    const replace = !isDeck && modeReplace.checked;
    if (replace && !window.confirm('Se borrará tu colección actual de este juego y se sustituirá por el contenido del archivo. ¿Continuar?')) return;
    importBtn.disabled = analyzeBtn.disabled = true;
    const note = el('p', { class: 'muted', text: 'Importando…' });
    report.append(note);
    try {
      const message = await opts.onImport({
        cards: parsed.cards,
        replace,
        name: nameInput.value.trim() || 'Mazo importado',
        deckFormat: fmtImport.value,
        description: parsed.meta.description || '',
        onProgress: (d, t) => { note.textContent = `Importando… ${d}/${t}`; },
      });
      toast(message, 'success');
      close();
    } catch (err) {
      note.remove();
      report.append(el('p', { class: 'tr-error', text: err.message }));
      importBtn.disabled = analyzeBtn.disabled = false;
    }
  });

  paneImport.append(
    el('p', { class: 'muted', text: isDeck
      ? 'Formatos: lista de texto (MTG Arena, MTGO, Moxfield…), YDK / ydke:// (Yu-Gi-Oh!), lista de números (Digimon), CSV y JSON de TCG Manager. El formato se detecta solo.'
      : 'Formatos: CSV de Moxfield, ManaBox, Archidekt, Deckbox y similares, lista de texto, CSV genérico y JSON de TCG Manager. El formato se detecta solo.' }),
    el('div', { class: 'field' }, el('label', { for: 'tr-file', text: 'Archivo' }), fileInput),
    pasteArea,
    el('div', { class: 'toolbar' }, analyzeBtn),
    report,
    options,
    el('div', { class: 'toolbar' }, importBtn)
  );

  dialog.append(
    el('div', { class: 'tr-head' }, el('h2', { text: isDeck ? 'Importar / exportar mazo' : 'Importar / exportar colección' }), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cerrar', onClick: close })),
    el('div', { class: 'tr-tabs' }, tabExport, tabImport),
    paneExport,
    paneImport
  );
  document.body.append(dialog);
  dialog.showModal();
  if (opts.defaultTab === 'import') show('import');
  refreshExport();
  return dialog;
}
