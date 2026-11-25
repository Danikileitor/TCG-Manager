// Diálogo "Estadísticas" del mazo: curva y reparto, probabilidades de robo y "qué me falta".
// Se carga solo al pulsar el botón (import dinámico). Todo el DOM se construye con textContent.
import { el, clear, toast } from './ui.js';
import { api } from './api.js';
import { facetsForCards } from './card-providers.js';
import { copyKey } from './deck-rules.js';
import { displayName } from './card-labels.js';

// ---------- Matemáticas ----------
const logFact = [0];
const lf = (n) => {
  for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  return logFact[n];
};
const lchoose = (n, k) => (k < 0 || k > n ? -Infinity : lf(n) - lf(k) - lf(n - k));

// Probabilidad de ver al menos `k` copias (de `K` en un mazo de `D`) tras robar `n` cartas
export function probAtLeast(D, K, n, k = 1) {
  n = Math.min(n, D);
  if (k <= 0) return 1;
  if (K < k || n < k) return 0;
  let p = 0;
  for (let i = k; i <= Math.min(K, n); i++) p += Math.exp(lchoose(K, i) + lchoose(D - K, n - i) - lchoose(D, n));
  return Math.min(1, p);
}

// ---------- Precios (solo MTG: Scryfall incluye el precio de Cardmarket en cada carta) ----------
const priceCache = new Map();
async function mtgPrices(cards) {
  const ids = [...new Set(cards.map((c) => c.cardId))].filter((id) => /^[0-9a-f-]{36}$/i.test(id) && !priceCache.has(id));
  for (let i = 0; i < ids.length; i += 75) {
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }),
      });
      if (!res.ok) break;
      const data = await res.json();
      (data.data || []).forEach((c) => {
        const p = c.prices || {};
        const eur = parseFloat(p.eur || p.eur_foil);
        priceCache.set(c.id, Number.isFinite(eur) ? eur : null);
      });
    } catch (err) {
      break;
    }
    if (i + 75 < ids.length) await new Promise((r) => setTimeout(r, 120));
  }
  return priceCache;
}
const euro = (n) => `${n.toFixed(2).replace('.', ',')} €`;

const HAND = { mtg: 7, ygo: 5, digimon: 5 };
const pct = (p) => `${(p * 100).toFixed(p >= 0.995 || p === 0 ? 0 : 1)} %`;

// ---------- Reparto ----------
function bars(title, rows, total) {
  const box = el('div', { class: 'st-card' }, el('h3', { text: title }));
  if (!rows.length) return box.appendChild(el('p', { class: 'muted', text: 'Sin datos' })) && box;
  const max = Math.max(...rows.map((r) => r.value));
  rows.forEach((r) => {
    const bar = el('i', { class: 'st-fill' });
    bar.style.width = `${Math.max(2, (r.value / max) * 100)}%`;
    if (r.color) bar.style.background = r.color;
    box.append(el('div', { class: 'st-row' }, el('span', { class: 'st-label', text: r.label }), el('span', { class: 'st-bar' }, bar), el('span', { class: 'st-val', text: total ? `${r.value}` : String(r.value) })));
  });
  return box;
}

const MTG_COLORS = { W: ['Blanco', '#e8e2c3'], U: ['Azul', '#4a8fd6'], B: ['Negro', '#7a6a80'], R: ['Rojo', '#d65a4a'], G: ['Verde', '#4aa86a'], C: ['Incoloro', '#a0a4ab'] };
const DGM_COLORS = { Red: '#d65a4a', Blue: '#4a8fd6', Yellow: '#e0c040', Green: '#4aa86a', Black: '#7a6a80', Purple: '#9a6ad6', White: '#e8e2c3' };

function distributions(gameKey, cards) {
  const count = (fn) => {
    const m = new Map();
    cards.forEach((c) => fn(c.facets).forEach((k) => m.set(k, (m.get(k) || 0) + c.quantity)));
    return m;
  };
  const sorted = (m, map = (k) => ({ label: String(k) })) => [...m].map(([k, v]) => ({ ...map(k), value: v })).sort((a, b) => b.value - a.value);
  const out = [];

  // Curva
  let curveCards = cards;
  let curveTitle = 'Curva de coste';
  let metric = (f) => f.cost;
  if (gameKey === 'mtg') curveCards = cards.filter((c) => !c.facets.types.includes('Land'));
  if (gameKey === 'ygo') {
    curveTitle = 'Niveles de los monstruos';
    curveCards = cards.filter((c) => c.facets.types.includes('Monstruo'));
    metric = (f) => f.level;
  }
  if (gameKey === 'digimon') curveTitle = 'Curva de coste de juego';
  const curve = new Map();
  curveCards.forEach((c) => {
    const v = metric(c.facets);
    if (v === null || v === undefined) return;
    const key = gameKey === 'mtg' && v >= 7 ? 7 : v;
    curve.set(key, (curve.get(key) || 0) + c.quantity);
  });
  const keys = [...curve.keys()].sort((a, b) => a - b);
  out.push(bars(curveTitle, keys.map((k) => ({ label: gameKey === 'mtg' && k === 7 ? '7+' : String(k), value: curve.get(k) })), true));

  if (gameKey === 'mtg') {
    out.push(bars('Colores', sorted(count((f) => f.colors), (k) => ({ label: (MTG_COLORS[k] || [k])[0], color: (MTG_COLORS[k] || [])[1] })), true));
  } else if (gameKey === 'digimon') {
    out.push(bars('Colores', sorted(count((f) => f.colors), (k) => ({ label: k, color: DGM_COLORS[k] })), true));
  } else {
    out.push(bars('Atributos', sorted(count((f) => (f.attribute ? [f.attribute] : []))), true));
  }
  out.push(bars('Tipos', sorted(count((f) => f.types)), true));
  return out;
}

// ---------- Probabilidades ----------
function probabilityPane(gameKey, deck) {
  const main = deck.cards.filter((c) => c.zone === 'main');
  const D = main.reduce((s, c) => s + c.quantity, 0);
  const pane = el('div', { class: 'tr-pane' });
  if (D < 1) return pane.appendChild(el('p', { class: 'muted', text: 'Añade cartas al mazo principal para calcular probabilidades.' })) && pane;

  const groups = new Map();
  main.forEach((c) => {
    const key = copyKey(gameKey, c);
    if (!groups.has(key)) groups.set(key, { name: displayName(c, gameKey), qty: 0 });
    groups.get(key).qty += c.quantity;
  });
  const select = el('select', { id: 'st-card', 'aria-label': 'Carta' });
  [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([key, g]) => select.append(el('option', { value: key, text: `${g.name} (x${g.qty})` })));
  const copies = el('input', { type: 'number', id: 'st-copies', min: 1, max: D, value: 1, 'aria-label': 'Copias que quieres ver' });
  const order = el('select', { id: 'st-order', 'aria-label': 'Orden de turno' }, el('option', { value: '0', text: 'Voy primero (sin robar el turno 1)' }), el('option', { value: '1', text: 'Voy segundo (robo el turno 1)' }));
  const table = el('div', { class: 'st-prob' });

  const update = () => {
    const K = groups.get(select.value).qty;
    const k = Math.max(1, Math.min(K, parseInt(copies.value, 10) || 1));
    const extra = parseInt(order.value, 10);
    clear(table);
    table.append(el('div', { class: 'st-prow st-phead' }, el('span', { text: 'Turno' }), el('span', { text: 'Cartas vistas' }), el('span', { text: `P(≥ ${k})` }), el('span')));
    for (let turn = 1; turn <= 8; turn++) {
      const n = HAND[gameKey] + (turn - 1) + extra;
      const p = probAtLeast(D, K, n, k);
      const bar = el('i', { class: 'st-fill' });
      bar.style.width = `${p * 100}%`;
      table.append(el('div', { class: 'st-prow' }, el('span', { text: turn === 1 ? '1 (mano inicial)' : String(turn) }), el('span', { text: String(Math.min(n, D)) }), el('strong', { text: pct(p) }), el('span', { class: 'st-bar' }, bar)));
    }
    copies.max = String(K);
  };
  [select, copies, order].forEach((n) => n.addEventListener('input', update));
  pane.append(
    el('p', { class: 'muted', text: `Mazo principal de ${D} cartas · mano inicial de ${HAND[gameKey]}. Probabilidad de ver al menos las copias indicadas de la carta elegida.` }),
    el('div', { class: 'st-controls' }, el('label', {}, 'Carta', select), el('label', {}, 'Copias ≥', copies), el('label', {}, 'Turno', order)),
    table
  );
  update();
  return pane;
}

// ---------- Qué me falta ----------
async function missingPane(gameKey, deck) {
  const pane = el('div', { class: 'tr-pane' }, el('div', { class: 'spinner' }));
  try {
    const { cards: owned } = await api.get(`/collection?game=${encodeURIComponent(gameKey)}`);
    const have = new Map();
    owned.forEach((c) => have.set(copyKey(gameKey, c), (have.get(copyKey(gameKey, c)) || 0) + (c.quantity || 0)));
    const need = new Map();
    deck.cards.forEach((c) => {
      const key = copyKey(gameKey, c);
      if (!need.has(key)) need.set(key, { id: c.cardId, name: c.altName || c.name, label: displayName(c, gameKey), qty: 0 });
      need.get(key).qty += c.quantity;
    });
    const missing = [...need.entries()]
      .map(([key, n]) => ({ ...n, miss: n.qty - Math.min(n.qty, have.get(key) || 0) }))
      .filter((n) => n.miss > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    clear(pane);
    const total = missing.reduce((s, m) => s + m.miss, 0);
    if (!missing.length) return pane.append(el('p', { text: '¡Tienes todas las cartas del mazo en tu colección!' })) || pane;
    const text = missing.map((m) => `${m.miss} ${m.name}`).join('\n');
    const prices = gameKey === 'mtg' ? await mtgPrices(deck.cards) : new Map();
    let cost = 0;
    const list = el('ul', { class: 'st-missing' });
    missing.forEach((m) => {
      const price = prices.get(m.id);
      if (price != null) cost += price * m.miss;
      list.append(el('li', {}, el('strong', { text: `${m.miss}×` }), ` ${m.label}`, price != null ? el('span', { class: 'muted', text: ` · ${euro(price)} c/u` }) : null));
    });
    const copy = el('button', { type: 'button', class: 'btn btn-sm', text: 'Copiar lista', onClick: () => navigator.clipboard.writeText(text).then(() => toast('Lista copiada', 'info'), () => toast('No se pudo copiar', 'error')) });
    const download = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Descargar .txt', onClick: () => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = el('a', { href: url, download: `lista-compra-${deck.name || 'mazo'}.txt` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } });
    pane.append(el('p', { text: `Te faltan ${total} copias (${missing.length} cartas distintas) respecto a tu colección${cost ? `. Coste aproximado: ${euro(cost)}` : ''}.` }), list, el('div', { class: 'toolbar' }, copy, download));
  } catch (err) {
    clear(pane);
    pane.append(el('p', { class: 'tr-error', text: err.message }));
  }
  return pane;
}

// ---------- Diálogo ----------
export async function openDeckStats({ gameKey, deck }) {
  const dialog = el('dialog', { class: 'tr-dialog st-dialog', 'aria-label': 'Estadísticas del mazo' });
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', () => setTimeout(() => dialog.remove(), 0));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  const body = el('div', {});
  const tabs = [
    ['Estadísticas', async () => statsPane(gameKey, deck)],
    ['Probabilidades', async () => probabilityPane(gameKey, deck)],
    ['Qué me falta', () => missingPane(gameKey, deck)],
  ];
  const tabBar = el('div', { class: 'tr-tabs' });
  const panes = new Map();
  const select = async (i) => {
    [...tabBar.children].forEach((b, j) => b.classList.toggle('active', i === j));
    clear(body);
    if (!panes.has(i)) panes.set(i, tabs[i][1]());
    body.append(el('div', { class: 'spinner' }));
    const pane = await panes.get(i);
    clear(body);
    body.append(pane);
  };
  tabs.forEach(([label], i) => tabBar.append(el('button', { type: 'button', text: label, onClick: () => select(i) })));

  dialog.append(el('div', { class: 'tr-head' }, el('h2', { text: `Estadísticas · ${deck.name || 'Mazo'}` }), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cerrar', onClick: close })), tabBar, body);
  document.body.append(dialog);
  dialog.showModal();
  select(0);
}

async function statsPane(gameKey, deck) {
  const pane = el('div', { class: 'st-grid' });
  const main = deck.cards.filter((c) => c.zone === 'main' || c.zone === 'commander');
  // Las cartas guardadas antes de existir esto no traen datos: se consultan una vez y se recuerdan en el mazo
  const lacking = main.filter((c) => !c.facets);
  if (lacking.length) {
    const found = await facetsForCards(gameKey, lacking).catch(() => new Map());
    lacking.forEach((c) => found.has(c.cardId) && (c.facets = found.get(c.cardId)));
  }
  const ready = main.filter((c) => c.facets);
  const total = main.reduce((s, c) => s + c.quantity, 0);
  pane.append(el('p', { class: 'muted st-wide', text: `${total} cartas en el mazo principal${ready.length < main.length ? ` · ${main.length - ready.length} sin datos (no se pudieron consultar)` : ''}.` }));
  distributions(gameKey, ready).forEach((n) => pane.append(n));
  if (gameKey === 'mtg') {
    const prices = await mtgPrices(deck.cards);
    const priced = deck.cards.filter((c) => prices.get(c.cardId) != null);
    const value = priced.reduce((s, c) => s + prices.get(c.cardId) * c.quantity, 0);
    pane.append(el('p', { class: 'st-wide', text: `Valor estimado del mazo: ${euro(value)} (precios de Cardmarket vía Scryfall${priced.length < deck.cards.length ? `; ${deck.cards.length - priced.length} cartas sin precio` : ''}).` }));
  } else {
    pane.append(el('p', { class: 'muted st-wide', text: 'Los precios solo están disponibles para MTG.' }));
  }
  return pane;
}
