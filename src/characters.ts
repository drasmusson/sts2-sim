export type CharacterName = "ironclad" | "silent" | "defect";

export const STARTING_DECKS: Record<CharacterName, string[]> = {
  ironclad: [
    "strike", "strike", "strike", "strike", "strike",
    "defend", "defend", "defend", "defend",
    "bash",
  ],
  silent: [
    "strike", "strike", "strike", "strike", "strike",
    "defend", "defend", "defend", "defend", "defend",
    "neutralize", "survivor",
  ],
  defect: [
    "strike", "strike", "strike", "strike",
    "defend", "defend", "defend", "defend",
    "zap", "dualcast",
  ],
};

export const CHARACTER_NAMES = Object.keys(STARTING_DECKS) as CharacterName[];
