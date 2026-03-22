import { Card } from "../src/cards.js";
import { PlayerState } from "../src/optimizer.js";

export const basePlayer: PlayerState = {
  strength: 0, vulnerable: false, weak: false, focus: 0, poisonTriggers: 1,
  exhaust: 0, blockPerExhaustEvent: 0, exhaustedThisTurn: false,
  currentBlock: 0, energyRemaining: 0, enemyAttack: 0, enemyHits: 1, enemyWeak: false,
};

export function makeCard(overrides: Partial<Card>): Card {
  return {
    type: "attack", cost: 1,
    damage: 0, block: 0, poison: 0, doom: 0,
    orbType: null, orbCount: 0, strGain: 0, vulnApplied: 0, weakApplied: 0,
    hits: 1, exhaustBonus: 0, blockAsDamage: false, xCost: false, draw: 0, energyGain: 0,
    selfExhaust: false, exhaustHandCount: 0, exhaustHandType: "", exhaustHandChoice: false,
    exhaustDrawCount: 0, blockPerExhaustEvent: 0, blockIfExhaustedTurn: 0,
    damagePerExhaustedHand: 0, blockPerExhaustedHand: 0, upgradeHandCount: 0, notes: "",
    ...overrides,
  };
}
