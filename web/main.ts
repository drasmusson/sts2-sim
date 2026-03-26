import { parseJsonDb } from "../src/cards-core";
import { renderResults, renderError, clearError } from "./ui";
import type { WebConfig, WorkerMessage } from "./worker";
import type { Mode } from "../src/optimizer";
import { STARTING_DECKS, CHARACTER_NAMES } from "../src/characters";

// ─── STATE ────────────────────────────────────────────────────────────────────
let cardsJson = "";
let cardNames: string[] = [];
let worker: Worker | null = null;

// ─── LOAD CSV ─────────────────────────────────────────────────────────────────
async function loadCsv(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}cards.json`);
  if (!res.ok) throw new Error(`Failed to load cards.json: ${res.status}`);
  cardsJson = await res.text();
  const db = parseJsonDb(cardsJson);
  cardNames = Object.keys(db).sort();
}

// ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────────
function setupAutocomplete(inputEl: HTMLInputElement, listEl: HTMLUListElement): void {
  inputEl.addEventListener("input", () => {
    const raw = inputEl.value;
    // find the last token (after the last comma)
    const lastComma = raw.lastIndexOf(",");
    const token = raw.slice(lastComma + 1).trim().toLowerCase();

    if (token.length < 1) { listEl.hidden = true; return; }

    const matches = cardNames.filter(n => n.includes(token)).slice(0, 8);
    if (!matches.length) { listEl.hidden = true; return; }

    listEl.innerHTML = matches
      .map(n => `<li data-name="${n}">${n}</li>`)
      .join("");
    listEl.hidden = false;
  });

  listEl.addEventListener("mousedown", (e) => {
    const li = (e.target as Element).closest("li");
    if (!li) return;
    e.preventDefault();
    const name = li.getAttribute("data-name")!;
    const raw = inputEl.value;
    const lastComma = raw.lastIndexOf(",");
    // replace last token with selected name + ", "
    inputEl.value = (lastComma >= 0 ? raw.slice(0, lastComma + 1) + " " : "") + name + ", ";
    listEl.hidden = true;
    inputEl.focus();
  });

  inputEl.addEventListener("blur", () => {
    // small delay so mousedown on list fires first
    setTimeout(() => { listEl.hidden = true; }, 150);
  });
}

// ─── FORM READING ─────────────────────────────────────────────────────────────
function parseCardList(val: string): string[] {
  return val.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

function readConfig(): WebConfig {
  const f = document.getElementById("sim-form") as HTMLFormElement;
  const d = new FormData(f);

  const player = {
    strength:       parseInt(d.get("strength") as string)        || 0,
    vulnerableStacks: parseInt(d.get("enemy-vulnerable") as string) || 0,
    weak:           (d.get("weak")       as string) === "on",
    frail:          (d.get("frail")      as string) === "on",
    focus:          parseInt(d.get("focus") as string)           || 0,
    poisonTriggers: parseInt(d.get("poison-triggers") as string) || 1,
    enemyAttack:    parseInt(d.get("enemy-attack") as string)    || 0,
    enemyHits:      parseInt(d.get("enemy-hits") as string)      || 1,
    enemyWeak:      (d.get("enemy-weak") as string) === "on",
    enemyStrength:  parseInt(d.get("enemy-strength") as string) || 0,
    exhaust:              parseInt(d.get("exhaust") as string)         || 0,
    blockPerExhaustEvent: 0,
    drawPerExhaustEvent:  0,
    damagePerBlockGain:   0,
    exhaustedThisTurn:    false,
    currentBlock:         0,
    energyRemaining:      0,
    selfDamageThisTurn:   0,
    attacksPlayedThisTurn: 0,
    nextAttackFree:        false,
    noMoreDraws:          false,
    corruptionActive:     false,
    vulnMultBonus:        0,
    hellraiserActive:     false,
    freeGeneratedCard:    null,
  };

  const rawDraws = parseInt(d.get("draws") as string ?? "");
  return {
    drawPile:    parseCardList(d.get("draw")    as string ?? ""),
    discardPile: parseCardList(d.get("discard") as string ?? ""),
    hand:        parseCardList(d.get("hand")    as string ?? ""),
    energy:      parseInt(d.get("energy")  as string) || 3,
    draws:       Number.isNaN(rawDraws) ? 5 : rawDraws,
    mode:        (d.get("mode") as Mode) ?? "dmg",
    player,
  };
}

// ─── WORKER ───────────────────────────────────────────────────────────────────
function runSim(config: WebConfig, n: number): void {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

  const spinner = document.getElementById("spinner") as HTMLElement;

  worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
    if (data.type === "progress") {
      spinner.textContent = `Simulating… ${data.done.toLocaleString()} / ${data.total.toLocaleString()}`;
      return;
    }
    setRunning(false);
    if (data.type === "complete") {
      clearError();
      renderResults(data.result, config, data.approximations);
    } else {
      renderError(data.message);
    }
  };

  worker.onerror = (e) => {
    setRunning(false);
    renderError(e.message);
  };

  worker.postMessage({ type: "run", cardsJson, config, n });
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function setRunning(running: boolean, total?: number): void {
  const btn     = document.getElementById("run-btn")     as HTMLButtonElement;
  const spinner = document.getElementById("spinner")     as HTMLElement;
  btn.disabled  = running;
  spinner.hidden = !running;
  if (running && total !== undefined) {
    spinner.textContent = `Simulating… 0 / ${total.toLocaleString()}`;
  } else if (!running) {
    spinner.textContent = "Running…";
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  try {
    await loadCsv();
  } catch (e) {
    renderError(`Could not load card data: ${e}`);
    return;
  }

  const drawInput    = document.getElementById("draw-input")    as HTMLInputElement;
  const drawAc       = document.getElementById("draw-ac")       as HTMLUListElement;
  const discardInput = document.getElementById("discard-input") as HTMLInputElement;
  const discardAc    = document.getElementById("discard-ac")    as HTMLUListElement;
  const handInput    = document.getElementById("hand-input")    as HTMLInputElement;
  const handAc       = document.getElementById("hand-ac")       as HTMLUListElement;

  setupAutocomplete(drawInput, drawAc);
  setupAutocomplete(discardInput, discardAc);
  setupAutocomplete(handInput, handAc);

  const characterSelect = document.getElementById("character-select") as HTMLSelectElement;

  characterSelect.addEventListener("change", () => {
    const val = characterSelect.value;
    if (CHARACTER_NAMES.includes(val as typeof CHARACTER_NAMES[number])) {
      drawInput.value = STARTING_DECKS[val as typeof CHARACTER_NAMES[number]].join(", ");
    }
  });

  drawInput.addEventListener("input", () => {
    characterSelect.value = "";
  });

  // collapsible player state
  const legend = document.querySelector("#player-state-fieldset legend") as HTMLElement;
  const body   = document.getElementById("player-state-body")           as HTMLElement;
  body.hidden  = true;
  legend.style.cursor = "pointer";
  legend.addEventListener("click", () => { body.hidden = !body.hidden; });

  document.getElementById("sim-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();
    const config = readConfig();
    const n = parseInt((document.getElementById("sims-input") as HTMLInputElement).value) || 5000;

    if (!config.drawPile.length) {
      renderError("Draw pile is empty — enter at least one card.");
      return;
    }

    setRunning(true, n);
    runSim(config, n);
  });
}

init();
