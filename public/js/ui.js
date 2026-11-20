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

export function cardThumb(card) {
  const src = safeImageUrl(card.imageUrl);
  const box = el('div', { class: 'thumb' });
  if (src) {
    box.append(el('img', { src, alt: card.name, loading: 'lazy', referrerpolicy: 'no-referrer' }));
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
