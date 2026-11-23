// Nombre que se muestra de una carta en el editor de mazos: "Nombre [Ace|Dual] SET"
//   MTG:     Yuriko, la Sombra del Tigre CMM
//   Digimon: Examon Ace BT20   ·   BeelStarmon Dual BT25
const DIGIMON_SET = /^([A-Za-z]+\d*)-/;

export function cardSet(card, gameKey) {
  if (gameKey === 'digimon') {
    const m = DIGIMON_SET.exec(String(card.cardId || ''));
    return m ? m[1].toUpperCase() : '';
  }
  return String(card.setCode || '').toUpperCase();
}

export function displayName(card, gameKey) {
  let name = String(card.name || '');
  if (gameKey === 'digimon') {
    name = name.split('//')[0].trim(); // las cartas Dual traen "Nombre // Nombre 2"
    const v = card.variant;
    if (v && !new RegExp(`\\b${v}\\b`, 'i').test(name)) name += ` ${v}`;
  }
  const set = cardSet(card, gameKey);
  return set ? `${name} ${set}` : name;
}
