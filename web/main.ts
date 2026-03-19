import { parseCsvText } from "../src/cards-core";
import { renderResults, renderError, clearError } from "./ui";
import type { WebConfig, WorkerMessage } from "./worker";
import type { Mode } from "../src/optimizer";

// ─── STATE ────────────────────────────────────────────────────────────────────
let csvText = "";
let cardNames: string[] = [];
let worker: Worker | null = null;

// ─── LOAD CSV ─────────────────────────────────────────────────────────────────
async function loadCsv(): Promise<void> {
  const res = await fetch("/cards.csv");
  if (!res.ok) throw new Error(`Failed to load cards.csv: ${res.status}`);
  csvText = await res.text();
  const db = parseCsvText(csvText);
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
    vulnerable:     (d.get("vulnerable") as string) === "on",
    weak:           (d.get("weak")       as string) === "on",
    focus:          parseInt(d.get("focus") as string)           || 0,
    poisonTriggers: parseInt(d.get("poison-triggers") as string) || 1,
    enemyAttack:    parseInt(d.get("enemy-attack") as string)    || 0,
    enemyHits:      parseInt(d.get("enemy-hits") as string)      || 1,
    enemyWeak:      (d.get("enemy-weak") as string) === "on",
    exhaust:        parseInt(d.get("exhaust") as string)         || 0,
    currentBlock:    0,
    energyRemaining: 0,
  };

  return {
    drawPile:    parseCardList(d.get("draw")    as string ?? ""),
    discardPile: parseCardList(d.get("discard") as string ?? ""),
    energy:      parseInt(d.get("energy")  as string) || 3,
    draws:       parseInt(d.get("draws")   as string) || 5,
    mode:        (d.get("mode") as Mode) ?? "dmg",
    player,
  };
}

// ─── WORKER ───────────────────────────────────────────────────────────────────
function runSim(config: WebConfig, n: number): void {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

  worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
    setRunning(false);
    if (data.type === "complete") {
      clearError();
      renderResults(data.result, config);
    } else {
      renderError(data.message);
    }
  };

  worker.onerror = (e) => {
    setRunning(false);
    renderError(e.message);
  };

  worker.postMessage({ type: "run", csvText, config, n });
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function setRunning(running: boolean): void {
  const btn     = document.getElementById("run-btn")     as HTMLButtonElement;
  const spinner = document.getElementById("spinner")     as HTMLElement;
  btn.disabled  = running;
  spinner.hidden = !running;
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

  setupAutocomplete(drawInput, drawAc);
  setupAutocomplete(discardInput, discardAc);

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

    setRunning(true);
    runSim(config, n);
  });
}

init();
