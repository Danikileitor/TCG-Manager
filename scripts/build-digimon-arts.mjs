// Genera public/data/digimon/arts.json: las versiones alternativas (artes paralelos, promos...) de
// cada carta de Digimon en inglés. La API de digimoncard.io no las incluye.
//
// Fuente: los datos de artes del proyecto Aegis (MIT), que a su vez los toma de TakaOtaku/Digimon-Card-App:
//   https://github.com/vinicius3333/aegis-digimon-tcg  (packages/shared/src/cards/data/arts.json)
//
// Uso (Node 18+):  node scripts/build-digimon-arts.mjs [ruta/local/a/arts.json]
// Resultado: { labels: [...], cards: { "BT17-077": [[1, idEtiqueta], [2, idEtiqueta], ...] } }
//   donde el número es el "_P<n>" del arte y idEtiqueta apunta a labels (pack o evento de ese arte).
//   Un tercer valor opcional es el id de imagen cuando no coincide con <carta>_P<n>.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_SRC = 'https://raw.githubusercontent.com/vinicius3333/aegis-digimon-tcg/main/packages/shared/src/cards/data/arts.json';
const local = process.argv[2];
const src = local ? JSON.parse(readFileSync(local, 'utf8')) : await (await fetch(URL_SRC)).json();

const labels = [];
const labelIndex = new Map();
const cards = {};
let total = 0;
for (const [cardId, arts] of Object.entries(src.cards)) {
  const list = [];
  for (const [suffix, labelId, imageId] of arts) {
    const m = /^_P(\d+)$/.exec(suffix); // solo impresiones en inglés (se excluyen las japonesas "-J")
    if (!m) continue;
    const label = String(src.labels[labelId] || '').trim();
    if (!labelIndex.has(label)) labelIndex.set(label, labels.push(label) - 1);
    const entry = [Number(m[1]), labelIndex.get(label)];
    if (imageId && imageId !== `${cardId}${suffix}`) entry.push(imageId);
    list.push(entry);
  }
  if (list.length) {
    cards[cardId] = list.sort((a, b) => a[0] - b[0]);
    total += list.length;
  }
}
const out = fileURLToPath(new URL('../public/data/digimon/arts.json', import.meta.url));
mkdirSync(new URL('../public/data/digimon/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify({ labels, cards, generated: new Date().toISOString().slice(0, 10) }));
console.log(`${total} artes alternativos de ${Object.keys(cards).length} cartas, ${labels.length} etiquetas -> ${out}`);
