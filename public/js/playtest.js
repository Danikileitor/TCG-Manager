// Modo "Partida de prueba": mesa en solitario en 2D para practicar el mazo (robar, jugar, descartar, girar...).
// La lógica está en playtest-logic.js; aquí solo se dibuja y se gestionan los clics y el arrastrar y soltar.
import { el, clear, toast, markPreviewable, safeImageUrl } from './ui.js';
import { betterImageUrl } from './card-images.js';
import { findDefaultBack, openCardViewer } from './card-viewer.js';
import { createPlaytest, defsFor, layoutFor } from './playtest-logic.js';

export async function openPlaytest({ gameKey, deck, mode = '2d' }) {
  const pt = createPlaytest(deck.cards, gameKey);
  if (pt.total === 0) return toast('El mazo no tiene cartas en la zona principal', 'error');
  const defs = defsFor(gameKey);
  const L = defs.labels;
  let backUrl = '';
  findDefaultBack('').then((u) => { backUrl = u || ''; render(); }).catch(() => {});

  const dialog = el('dialog', { class: 'hand-sim playtest', 'aria-label': 'Partida de prueba' });
  const bar = el('div', { class: 'pt-bar' });
  const board = el('div', { class: 'pt-board' });
  const panel = el('div', { class: 'pt-panel hidden' });
  const menu = el('div', { class: 'pt-menu hidden', role: 'menu' });
  dialog.append(bar, board, panel, menu);
  document.body.append(dialog);
  dialog.showModal();

  let scene = null; // escena 3D (solo en modo 3D)
  let panelZone = null; // zona abierta en el panel lateral
  let panelFilter = '';
  const close = () => { if (scene) scene.dispose(); dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', () => setTimeout(() => dialog.remove(), 0));
  document.addEventListener('keydown', onKey);
  dialog.addEventListener('close', () => { document.removeEventListener('keydown', onKey); if (scene) scene.dispose(); });
  function onKey(e) {
    if (!dialog.isConnected || e.target.closest('input, textarea, select')) return;
    if (e.key === 'd' || e.key === 'D') act(() => pt.draw(1));
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); act(() => pt.undo()); }
  }
  dialog.addEventListener('click', (e) => { if (!menu.contains(e.target)) hideMenu(); });

  function act(fn) { fn(); hideMenu(); render(); }
  function hideMenu() { menu.classList.add('hidden'); }

  // ---------- Cartas ----------
  function cardEl(card, zone) {
    const hidden = card.faceDown;
    const node = el('div', { class: `pt-card${card.tapped ? ' tapped' : ''}${hidden ? ' down' : ''}`, draggable: 'true', tabindex: '0', title: hidden ? 'Boca abajo' : card.name, 'data-uid': String(card.uid) });
    const src = betterImageUrl(safeImageUrl(card.imageUrl));
    if (hidden) {
      if (backUrl) node.style.backgroundImage = `url("${backUrl}")`;
    } else if (src) {
      const img = el('img', { src, alt: card.name, draggable: 'false', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => { img.remove(); node.append(el('span', { class: 'pt-name', text: card.name })); });
      node.append(img);
      markPreviewable(node, card);
    } else node.append(el('span', { class: 'pt-name', text: card.name }));
    node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(card.uid)); e.dataTransfer.effectAllowed = 'move'; hideMenu(); });
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(card, zone, e.clientX, e.clientY); });
    // Un clic abre el menú tras una breve espera; si llega un segundo clic (doble clic) se cancela y se juega / gira la carta
    let menuTimer = 0;
    node.addEventListener('dblclick', () => { clearTimeout(menuTimer); act(() => (zone === 'field' ? pt.toggleTap(card.uid) : pt.move(card.uid, 'field'))); });
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = node.getBoundingClientRect(); openMenu(card, zone, r.left, r.bottom); } });
    node.addEventListener('click', (e) => {
      e.stopPropagation(); // el clic abre el menú de la carta, no la vista 3D (la vista previa al pasar el ratón sigue funcionando)
      const x = e.clientX;
      const y = e.clientY;
      clearTimeout(menuTimer);
      menuTimer = setTimeout(() => openMenu(card, zone, x, y), 230);
    });
    return node;
  }

  function openMenu(card, zone, x, y) {
    clear(menu);
    const item = (text, fn) => menu.append(el('button', { type: 'button', role: 'menuitem', text, onClick: () => act(fn) }));
    menu.append(el('div', { class: 'pt-menu-title', text: card.faceDown ? 'Carta boca abajo' : card.name }));
    if (!card.faceDown && card.imageUrl) menu.append(el('button', { type: 'button', role: 'menuitem', text: 'Ver en grande (3D)', onClick: () => { hideMenu(); openCardViewer({ name: card.name, imageUrl: card.imageUrl, imageBack: card.imageBack, backKind: card.backKind }); } }));
    if (zone === 'field') item(card.tapped ? 'Enderezar' : 'Girar', () => pt.toggleTap(card.uid));
    item(card.faceDown ? 'Poner boca arriba' : 'Poner boca abajo', () => pt.toggleFace(card.uid));
    Object.keys(L).filter((z) => z !== zone && z !== 'library').forEach((z) => item(`→ ${L[z]}`, () => pt.move(card.uid, z)));
    if (zone !== 'library') {
      item(`→ Arriba de ${L.library}`, () => pt.move(card.uid, 'library', 'top'));
      item(`→ Fondo de ${L.library}`, () => pt.move(card.uid, 'library', 'bottom'));
    } else {
      item(`→ Arriba de ${L.library}`, () => pt.move(card.uid, 'library', 'top'));
      item(`→ Fondo de ${L.library}`, () => pt.move(card.uid, 'library', 'bottom'));
    }
    menu.classList.remove('hidden');
    const r = dialog.getBoundingClientRect();
    menu.style.left = `${Math.min(x - r.left, r.width - 230)}px`;
    menu.style.top = `${Math.min(y - r.top, r.height - menu.offsetHeight - 10)}px`;
    menu.querySelector('button')?.focus();
  }

  // ---------- Zonas ----------
  // target: { zone, area?, slot? } (area y slot solo para el campo)
  function dropTarget(node, target) {
    const zone = target.zone;
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('over'); });
    node.addEventListener('dragleave', () => node.classList.remove('over'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('over');
      const uid = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isFinite(uid)) act(() => pt.move(uid, zone, zone === 'library' ? 'top' : 'end', { area: target.area, slot: target.slot }));
    });
    return node;
  }

  function pile(zone) {
    const cards = pt.zones[zone];
    const top = cards[cards.length - 1];
    const face = el('div', { class: 'pt-pile-face' });
    if (zone === 'library' || zone === 'security' || zone === 'extra' && gameKey === 'digimon') {
      if (backUrl) face.style.backgroundImage = `url("${backUrl}")`;
      else face.classList.add('plain');
    } else if (top && betterImageUrl(safeImageUrl(top.imageUrl)) && !top.faceDown) {
      face.append(el('img', { src: betterImageUrl(safeImageUrl(top.imageUrl)), alt: top.name, draggable: 'false', referrerpolicy: 'no-referrer' }));
    }
    const node = el('button', { type: 'button', class: 'pt-pile', title: zone === 'library' ? `${L[zone]}: clic para robar · ⋯ para ver` : `${L[zone]}: clic para ver` }, face, el('span', { class: 'pt-count', text: String(cards.length) }), el('span', { class: 'pt-pile-label', text: L[zone] }));
    node.addEventListener('click', () => (zone === 'library' ? act(() => pt.draw(1)) : openPanel(zone)));
    return dropTarget(node, { zone });
  }

  function openPanel(zone) {
    panelZone = zone;
    panelFilter = '';
    render();
  }

  function renderPanel() {
    clear(panel);
    if (!panelZone || !pt.zones[panelZone]) return panel.classList.add('hidden');
    panel.classList.remove('hidden');
    const search = el('input', { type: 'search', placeholder: 'Buscar por nombre…', 'aria-label': 'Buscar en la zona', value: panelFilter });
    search.addEventListener('input', () => { panelFilter = search.value; renderPanelList(); });
    const list = el('div', { class: 'pt-panel-list' });
    function renderPanelList() {
      clear(list);
      const q = panelFilter.trim().toLowerCase();
      const cards = [...pt.zones[panelZone]].filter((c) => !q || c.name.toLowerCase().includes(q) || (c.altName || '').toLowerCase().includes(q));
      if (panelZone === 'library' && !q) cards.sort((a, b) => a.name.localeCompare(b.name)); // la biblioteca se enseña ordenada por nombre
      if (!cards.length) list.append(el('p', { class: 'muted', text: 'No hay cartas.' }));
      cards.forEach((c) => list.append(cardEl({ ...c, faceDown: false }, panelZone)));
    }
    renderPanelList();
    panel.append(el('div', { class: 'pt-panel-head' }, el('strong', { text: `${L[panelZone]} (${pt.zones[panelZone].length})` }), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cerrar', onClick: () => { panelZone = null; render(); } })), search, list);
  }

  // ---------- Pantalla ----------
  function render() {
    clear(bar);
    const b = (text, fn, extra = {}) => el('button', { type: 'button', class: 'btn btn-sm', text, onClick: () => act(fn), ...extra });
    const n = el('input', { type: 'number', min: 1, max: 99, value: '3', 'aria-label': 'Número de cartas', class: 'pt-n' });
    const nVal = () => Math.max(1, Math.min(99, parseInt(n.value, 10) || 1));
    const mull = b(pt.rules.mulligan === 'london' ? 'Mulligan (Londres)' : 'Mulligan', () => pt.mulligan(), { disabled: !pt.canMulligan || undefined });
    const undo = b('Deshacer', () => pt.undo(), { title: 'Ctrl+Z', disabled: !pt.canUndo || undefined });
    bar.append(
      el('strong', { class: 'pt-title', text: `Partida de prueba · ${deck.name || 'Mazo'}` }),
      el('span', { class: 'pt-turn', text: `Turno ${pt.turn}` }),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: mode === '3d' ? 'Vista 2D' : 'Vista 3D', onClick: () => switchMode(mode === '3d' ? '2d' : '3d') }),
      b('Robar (D)', () => pt.draw(1)),
      b('Robar', () => pt.draw(nVal())), n,
      b('Moler', () => pt.mill(nVal()), { title: `Las cartas de arriba de ${L.library} van a ${L.graveyard}` }),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: `Ver ${L.library}`, onClick: () => openPanel('library') }),
      b('Barajar', () => pt.shuffleLibrary()),
      b('Siguiente turno', () => pt.nextTurn(), { title: 'Endereza el campo y roba una carta' }),
      mull, undo,
      b('Reiniciar', () => { pt.reset(); panelZone = null; }),
      el('button', { type: 'button', class: 'hs-close', text: '✕', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', onClick: close })
    );

    if (mode === '3d' && scene) {
      scene.sync();
      renderPanel();
      return;
    }
    clear(board);
    const layout = layoutFor(gameKey);
    const grid = el('div', { class: `pt-layout pt-theme-${layout.theme}` });
    grid.style.setProperty('--cols', layout.cols);
    grid.style.setProperty('--rows', layout.rows);
    grid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    const place = (node, c, r, w = 1, h = 1) => { node.style.gridColumn = `${c + 1} / span ${w}`; node.style.gridRow = `${r + 1} / span ${h}`; return node; };
    const fieldCards = (area) => pt.zones.field.filter((c) => c.area === area);
    for (const cell of layout.cells) {
      if (cell.kind === 'pile') {
        if (pt.zones[cell.zone]) grid.append(place(el('div', { class: 'pt-cell' }, pile(cell.zone)), cell.c, cell.r));
      } else if (cell.kind === 'free') {
        const area = dropTarget(el('div', { class: 'pt-field pt-area' }, el('span', { class: 'pt-zone-label', text: cell.label })), { zone: 'field', area: cell.area });
        fieldCards(cell.area).forEach((c) => area.append(cardEl(c, 'field')));
        grid.append(place(area, cell.c, cell.r, cell.w, cell.h));
      } else {
        cell.cells.forEach(([c, r], i) => {
          const slot = dropTarget(el('div', { class: 'pt-field pt-slot', title: cell.label }, i === 0 ? el('span', { class: 'pt-zone-label', text: cell.label }) : null), { zone: 'field', area: cell.area, slot: i });
          pt.zones.field.filter((x) => x.area === cell.area && x.slot === i).forEach((x) => slot.append(cardEl(x, 'field')));
          grid.append(place(slot, c, r));
        });
      }
    }
    const hand = dropTarget(el('div', { class: 'pt-hand' }, el('span', { class: 'pt-zone-label', text: `${L.hand} (${pt.zones.hand.length})` })), { zone: 'hand' });
    const fan = el('div', { class: 'pt-fan' });
    pt.zones.hand.forEach((c) => fan.append(cardEl(c, 'hand')));
    hand.append(fan);
    board.append(el('div', { class: 'pt-center' }, grid, hand));
    renderPanel();
  }

  async function startScene() {
    const { createScene } = await import('./playtest3d.js'); // WebGL solo se descarga en modo 3D
    clear(board);
    const stage = el('div', { class: 'pt3d-stage' });
    board.append(stage);
    try {
      scene = createScene({
        stage, pt, L, gameKey,
        getBackUrl: () => findDefaultBack(''),
        onMenu: (card, zone, x, y) => openMenu(card, zone, x, y),
        onDouble: (card, zone) => act(() => (zone === 'field' ? pt.toggleTap(card.uid) : pt.move(card.uid, 'field'))),
        onPile: (zone) => (zone === 'library' ? act(() => pt.draw(1)) : openPanel(zone)),
        onDrop: (uid, target) => act(() => pt.move(uid, target.zone, target.zone === 'library' ? 'top' : 'end', { area: target.area, slot: target.slot })),
      });
      dialog._scene = scene; // (para pruebas)
      return true;
    } catch (err) {
      scene = null;
      toast('Tu navegador no puede mostrar la vista 3D: se usa la 2D', 'error');
      return false;
    }
  }

  async function switchMode(next) {
    if (next === mode) return;
    if (scene) { scene.dispose(); scene = null; }
    mode = next;
    if (mode === '3d' && !(await startScene())) mode = '2d';
    render();
  }

  if (mode === '3d' && !(await startScene())) mode = '2d';
  render();
}
