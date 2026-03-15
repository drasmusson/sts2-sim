// ─── DRAW ENGINE ─────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCards(drawPile, discardPile, n) {
  let draw = [...drawPile];
  let discard = [...discardPile];
  const hand = [];

  for (let i = 0; i < n; i++) {
    if (draw.length === 0) {
      if (discard.length === 0) break;
      draw = shuffle(discard);
      discard = [];
    }
    hand.push(draw.pop());
  }

  return { hand, drawPile: draw, discardPile: discard };
}

module.exports = { shuffle, drawCards };
