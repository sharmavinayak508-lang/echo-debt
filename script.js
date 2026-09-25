/* ===================== ECHO DEBT ===================== */
/* Tile legend:
   # wall   . floor   P start   E exit   S switch   D door
*/
const LEVELS = [
  // Level 1 — simple intro, no echo needed
  [
    "##########",
    "#P.......#",
    "#.######.#",
    "#........#",
    "#.######.#",
    "#.......E#",
    "##########",
  ],
  // Level 2 — needs the Echo to hold the switch so the door stays open
  [
    "##########",
    "#P.......#",
    "#.####.#.#",
    "#.#..#.#.#",
    "#.#S##.#.#",
    "#.#..D...#",
    "#.#..#.###",
    "#........#",
    "#.######E#",
    "##########",
  ],
  // Level 3 — two switches, tighter timing
  [
    "############",
    "#P.........#",
    "#.###.###.##",
    "#.#S#.#S#..#",
    "#.#.#.#.#..#",
    "#.#.D.D.#..#",
    "#.#.....#..#",
    "#.#######..#",
    "#..........#",
    "#.########E#",
    "############",
  ],
];

let levelIndex = 0;
let grid = [];
let rows = 0, cols = 0;
let start = { r: 0, c: 0 };

let player = { r: 0, c: 0 };
let currentActions = [];      // actions recorded THIS attempt
let previousActions = [];     // actions from the LAST attempt (what the Echo plays)
let echo = null;              // {r,c} or null if no echo yet this level
let echoStep = 0;
let doorsOpen = new Set();    // indices of open doors this attempt
let echoDebt = 0;             // total retries across the run, shown as flavor stat

const boardEl = document.getElementById("board");
const levelLabel = document.getElementById("level-label");
const debtLabel = document.getElementById("debt-label");
const toastEl = document.getElementById("toast");

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function toast(msg, ms = 1400) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
}

/* ---------- Level loading ---------- */
function loadLevel(index) {
  const layout = LEVELS[index];
  rows = layout.length;
  cols = layout[0].length;
  grid = layout.map(row => row.split(""));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === "P") { start = { r, c }; grid[r][c] = "."; }
    }
  }

  player = { ...start };
  currentActions = [];
  previousActions = [];
  echo = null;
  echoStep = 0;
  doorsOpen = new Set();

  levelLabel.textContent = `LEVEL ${index + 1} / ${LEVELS.length}`;
  debtLabel.textContent = `ECHO DEBT: ${echoDebt}`;
  buildBoard();
  render();
}

function buildBoard() {
  boardEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell,36px))`;
  boardEl.innerHTML = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const div = document.createElement("div");
      div.className = "cell " + cellClass(grid[r][c]);
      div.dataset.r = r;
      div.dataset.c = c;
      div.textContent = cellGlyph(grid[r][c]);
      boardEl.appendChild(div);
    }
  }
}

function cellClass(t) {
  if (t === "#") return "wall";
  if (t === "E") return "exit";
  if (t === "S") return "switch";
  if (t === "D") return "door";
  return "";
}
function cellGlyph(t) {
  if (t === "E") return "◉";
  if (t === "S") return "◆";
  if (t === "D") return "▦";
  return "";
}

/* ---------- Rendering ---------- */
function render() {
  // door open/closed styling
  document.querySelectorAll(".cell.door").forEach(el => {
    const key = `${el.dataset.r},${el.dataset.c}`;
    el.classList.toggle("open", doorsOpen.has(key));
  });

  document.querySelectorAll(".player,.echo").forEach(el => el.remove());

  if (echo) {
    const echoCell = boardEl.querySelector(`.cell[data-r="${echo.r}"][data-c="${echo.c}"]`);
    if (echoCell) {
      const e = document.createElement("div");
      e.className = "echo";
      e.textContent = "◈";
      echoCell.appendChild(e);
    }
  }
  const playerCell = boardEl.querySelector(`.cell[data-r="${player.r}"][data-c="${player.c}"]`);
  if (playerCell) {
    const p = document.createElement("div");
    p.className = "player";
    p.textContent = "★";
    playerCell.appendChild(p);
  }
}

/* ---------- Movement ---------- */
const DELTAS = {
  up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1], wait: [0, 0],
};

function tileAt(r, c) {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return "#";
  return grid[r][c];
}

function isWalkable(r, c) {
  const t = tileAt(r, c);
  if (t === "#") return false;
  if (t === "D" && !doorsOpen.has(`${r},${c}`)) return false;
  return true;
}

function tryMove(entity, dir) {
  const [dr, dc] = DELTAS[dir];
  const nr = entity.r + dr, nc = entity.c + dc;
  if (isWalkable(nr, nc)) { entity.r = nr; entity.c = nc; }
  return entity;
}

function updateSwitches() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== "S") continue;
      const occupied =
        (player.r === r && player.c === c) ||
        (echo && echo.r === r && echo.c === c);
      // Each switch controls the nearest door of the same "column group";
      // simplest working rule: switch stays linked to ALL doors while held.
      if (occupied) markLinkedDoorsOpen(r, c);
    }
  }
}

// Open the door(s) associated with a switch: any 'D' reachable without
// crossing another switch/door pairing — for our hand-built levels this
// resolves to "all doors open while at least one switch is held".
function markLinkedDoorsOpen(sr, sc) {
  let anyHeld = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== "S") continue;
      const occ =
        (player.r === r && player.c === c) ||
        (echo && echo.r === r && echo.c === c);
      if (occ) anyHeld = true;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === "D") {
        const key = `${r},${c}`;
        if (anyHeld) doorsOpen.add(key);
        else doorsOpen.delete(key);
      }
    }
  }
}

function step(dir) {
  // move player
  tryMove(player, dir);
  currentActions.push(dir);

  // advance echo along the previous run, if any
  if (previousActions.length) {
    if (!echo) echo = { ...start };
    const echoDir = previousActions[echoStep] || "wait";
    tryMove(echo, echoDir);
    echoStep++;
    if (echoStep >= previousActions.length) {
      // echo finished its recorded run; it just stands still afterward
    }
  }

  updateSwitches();
  render();

  const t = tileAt(player.r, player.c);
  if (t === "E") {
    onLevelComplete();
  }
}

function onLevelComplete() {
  toast("LEVEL COMPLETE");
  levelIndex++;
  echoDebt += 1;
  if (levelIndex >= LEVELS.length) {
    setTimeout(() => showScreen("victory-screen"), 700);
  } else {
    setTimeout(() => loadLevel(levelIndex), 700);
  }
}

function retryWithEcho() {
  if (currentActions.length === 0) {
    toast("Move first, then retry to leave an Echo.");
    return;
  }
  previousActions = currentActions;
  currentActions = [];
  player = { ...start };
  echo = { ...start };
  echoStep = 0;
  doorsOpen = new Set();
  echoDebt += 1;
  debtLabel.textContent = `ECHO DEBT: ${echoDebt}`;
  toast("Echo created from your last run.");
  render();
}

function restartLevelHard() {
  loadLevel(levelIndex);
}

/* ---------- Input ---------- */
const KEYMAP = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
  " ": "wait",
};

document.addEventListener("keydown", (e) => {
  if (document.getElementById("game-screen").classList.contains("hidden")) return;
  const dir = KEYMAP[e.key];
  if (dir) { e.preventDefault(); step(dir); }
});

document.querySelectorAll(".dpad").forEach(btn => {
  btn.addEventListener("click", () => step(btn.dataset.dir));
});

/* ---------- Screen wiring ---------- */
document.getElementById("play-btn").addEventListener("click", () => {
  levelIndex = 0;
  echoDebt = 0;
  showScreen("game-screen");
  loadLevel(levelIndex);
});
document.getElementById("how-btn").addEventListener("click", () => showScreen("how-screen"));
document.getElementById("back-btn").addEventListener("click", () => showScreen("start-screen"));
document.getElementById("play-again-btn").addEventListener("click", () => {
  levelIndex = 0;
  echoDebt = 0;
  showScreen("game-screen");
  loadLevel(levelIndex);
});
document.getElementById("retry-btn").addEventListener("click", retryWithEcho);
document.getElementById("restart-level-btn").addEventListener("click", restartLevelHard);

showScreen("start-screen");
