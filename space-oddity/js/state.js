// =====================================================
// GAME STATE + PERSISTENCE (localStorage, single key).
// State is one serializable object — easy to migrate
// to IndexedDB later.
// =====================================================

const SAVE_KEY = "spaceOddity.save.v1";

function defaultGameState() {
  return {
    version: 1,
    player: {
      credits: STARTING_CREDITS,
      inventory: { ferriteOre: 0, cobaltCrystal: 0, voidShard: 0 },
      ship: { drillLevel: 1, cargoLevel: 1, reactorLevel: 1 },
    },
    market: JSON.parse(JSON.stringify(MARKET_START)),
    courierOffers: [],
    currentMission: null,
    eventLog: ["> Systems online. Welcome aboard, Commander."],
    selectedPanel: "mine",          // "mine" | "market" | "upgrade"
    selectedShipPart: null,         // "drill" | "cargo" | "reactor" | null
    currentScene: "station",
  };
}

let GameState = null;

function saveState() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(GameState));
  } catch (e) {
    console.error("Failed to persist game state:", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultGameState();
    const parsed = JSON.parse(raw);
    // Shallow-merge over defaults so future fields don't break old saves
    const def = defaultGameState();
    return Object.assign(def, parsed, {
      player: Object.assign(def.player, parsed.player),
      market: Object.assign(def.market, parsed.market),
    });
  } catch (e) {
    console.error("Failed to load save, starting fresh:", e);
    return defaultGameState();
  }
}

function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  GameState = defaultGameState();
  saveState();
}

function logEvent(message) {
  GameState.eventLog.push("> " + message);
  if (GameState.eventLog.length > MAX_LOG_LINES) {
    GameState.eventLog = GameState.eventLog.slice(-MAX_LOG_LINES);
  }
}
