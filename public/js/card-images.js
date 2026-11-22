// Tamaños de imagen de las cartas.
// En las listas se guarda la imagen pequeña; para el tooltip y la vista 3D se pide la misma
// imagen en un tamaño mayor cuando la fuente lo permite (Scryfall y YGOPRODeck).
export function sizedUrl(url, size) {
  if (!url) return '';
  // Scryfall: .../small/front/... -> normal (tooltip) o png (vista 3D, 745x1040 px)
  if (url.includes('://cards.scryfall.io/')) {
    if (size === 'tip') return url.replace(/\/(small|normal|large|png)\//, '/normal/').replace(/\.png(\?|$)/, '.jpg$1');
    return url.replace(/\/(small|normal|large|png)\//, '/png/').replace(/\.jpg(\?|$)/, '.png$1');
  }
  // YGOPRODeck: /cards_small/ -> /cards/ (tamaño completo)
  if (url.includes('://images.ygoprodeck.com/images/cards_small/')) {
    return url.replace('/images/cards_small/', '/images/cards/');
  }
  return url;
}

// Versiones a probar para la vista 3D, de mejor a peor calidad (la última es la imagen original)
export function viewerUrls(url) {
  const list = [sizedUrl(url, 'large')];
  if (url.includes('://cards.scryfall.io/')) list.push(url.replace(/\/(small|normal|large|png)\//, '/large/').replace(/\.png(\?|$)/, '.jpg$1'));
  list.push(url);
  list.push(...imageChain(url));
  return [...new Set(list)];
}

// Digimon: las imágenes del servidor de la comunidad (web-garage.takaotaku.de) tienen más resolución que las de
// digimoncard.io, y tiene tanto las normales como los artes alternativos. Se usan como primera opción.
const DIGIMON_IO = /^https:\/\/images\.digimoncard\.io\/images\/cards\/([A-Za-z0-9_-]+)\.(?:jpg|webp|png)(?:\?.*)?$/;
const DIGIMON_GARAGE = /^https:\/\/web-garage\.takaotaku\.de\/([A-Za-z0-9_-]+)\.webp(?:\?.*)?$/;
const DIGIMON_IO_WEBP = 'https://images.digimoncard.io/images/cards/';

// Cambia una imagen de digimoncard.io (la que guardan las cartas ya añadidas) por la de mayor resolución
export function betterImageUrl(url) {
  const m = DIGIMON_IO.exec(url || '');
  return m ? `https://web-garage.takaotaku.de/${m[1]}.webp` : url;
}

// Siguiente imagen a probar cuando una no existe ('' si no quedan). Digimon: servidor de la comunidad ->
// digimoncard.io (.webp) -> lista oficial de Bandai.
export function imageFallback(url) {
  let m = DIGIMON_GARAGE.exec(url || '');
  if (m) return `${DIGIMON_IO_WEBP}${m[1]}.webp`;
  m = DIGIMON_IO.exec(url || '');
  return m ? `https://world.digimoncard.com/images/cardlist/card/${m[1].replace(/-Errata$/, '')}.png` : '';
}

// Cadena completa de alternativas
export function imageChain(url) {
  const chain = [];
  for (let next = imageFallback(url); next && chain.length < 5; next = imageFallback(next)) chain.push(next);
  return chain;
}
