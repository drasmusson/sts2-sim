// ─── DRAW ENGINE ─────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface DrawResult {
  hand:        string[];
  drawPile:    string[];
  discardPile: string[];
}

export function drawCards(drawPile: string[], discardPile: string[], n: number): DrawResult {
  let draw = [...drawPile];
  let discard = [...discardPile];
  const hand: string[] = [];

  for (let i = 0; i < n; i++) {
    if (draw.length === 0) {
      if (discard.length === 0) break;
      draw = shuffle(discard);
      discard = [];
    }
    hand.push(draw.pop()!);
  }

  return { hand, drawPile: draw, discardPile: discard };
}
