import { imageFallback } from './card-images.js';

// Utilidades de interfaz. Se construye el DOM con textContent (nunca innerHTML
// con datos de usuario) para evitar XSS.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Icono de papelera (SVG en línea, hereda el color del texto)
export function trashIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  for (const d of ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 11v6', 'M14 11v6']) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function toast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = el('div', { class: 'toast-container' });
    document.body.append(container);
  }
  const t = el('div', { class: `toast ${type}`, text: message });
  container.append(t);
  setTimeout(() => t.remove(), 3500);
}

// Solo permitimos imágenes http(s) para evitar esquemas peligrosos
export function safeImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch (err) {
    return '';
  }
}

// Si la imagen no carga, prueba la alternativa (si la hay) y, si tampoco, llama a onFail
export function withImageFallback(img, onFail) {
  img.addEventListener('error', () => {
    const fb = img.dataset.fallbackTried ? '' : imageFallback(img.getAttribute('src'));
    if (fb) {
      img.dataset.fallbackTried = '1';
      img.src = fb;
    } else onFail();
  });
  return img;
}

// Marca un elemento para que, al pasar el ratón, se vea la carta en grande (tooltip) y, al
// hacer clic, se abra la vista 3D (card-viewer.js, que escucha estos atributos).
export function markPreviewable(node, card) {
  const image = safeImageUrl(card.imageUrl);
  if (!image) return node;
  node.classList.add('previewable');
  node.dataset.cardName = card.name || '';
  node.dataset.cardImage = image;
  node.dataset.cardBack = safeImageUrl(card.imageBack) || '';
  node.dataset.cardBackKind = card.backKind || (card.zone === 'digi-egg' ? 'egg' : '');
  return node;
}

export function cardThumb(card) {
  const src = safeImageUrl(card.imageUrl);
  const box = el('div', { class: 'thumb' });
  if (src) {
    const img = markPreviewable(el('img', { src, alt: card.name, loading: 'lazy', referrerpolicy: 'no-referrer' }), card);
    withImageFallback(img, () => {
      img.remove();
      box.textContent = card.name;
    });
    box.append(img);
  } else {
    box.textContent = card.name;
  }
  return box;
}

export function debounce(fn, ms = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
