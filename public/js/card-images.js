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
  const fb = imageFallback(url);
  if (fb) list.push(fb);
  return [...new Set(list)];
}

// Imagen alternativa cuando la principal no existe. Los artes alternativos de Digimon se piden al
// servidor de imágenes de la comunidad (web-garage.takaotaku.de); si falla, se prueba la lista oficial de Bandai.
export function imageFallback(url) {
  const m = /^https:\/\/web-garage\.takaotaku\.de\/([A-Za-z0-9_-]+)\.webp(?:\?.*)?$/.exec(url || '');
  return m ? `https://world.digimoncard.com/images/cardlist/card/${m[1].replace(/-Errata$/, '')}.png` : '';
}
