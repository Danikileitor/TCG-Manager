// Precios de MTG (Cardmarket, en euros) a través de Scryfall. Se cachean en memoria durante la visita.
const priceCache = new Map();
export async function mtgPrices(cards, onProgress) {
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
    if (onProgress) onProgress(Math.min(i + 75, ids.length), ids.length);
    if (i + 75 < ids.length) await new Promise((r) => setTimeout(r, 120));
  }
  return priceCache;
}
export const euro = (n) => `${n.toFixed(2).replace('.', ',')} €`;

