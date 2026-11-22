// Tamaños de imagen de las cartas.
// En las listas se guarda la imagen pequeña; para el tooltip y la vista 3D se pide la misma
// imagen en un tamaño mayor cuando la fuente lo permite (Scryfall y YGOPRODeck).
export function sizedUrl(url, size) {
  if (!url) return '';
  // Scryfall: .../small/front/... -> .../normal/... o .../large/...
  if (url.includes('://cards.scryfall.io/')) {
    return url.replace(/\/(small|normal|large|png)\//, `/${size === 'tip' ? 'normal' : 'large'}/`);
  }
  // YGOPRODeck: /cards_small/ -> /cards/ (tamaño completo)
  if (url.includes('://images.ygoprodeck.com/images/cards_small/')) {
    return url.replace('/images/cards_small/', '/images/cards/');
  }
  return url;
}
