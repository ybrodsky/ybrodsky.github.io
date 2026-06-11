# Space Oddity — AI Context

Browser-based idle mining game. Vanilla JS, zero dependencies, no build step.

## Quick Start

Open `index.html` directly in browser.

## Architecture

**Script load order matters** (globals, no modules):

```
config.js → state.js → logic.js → scene.js → ui.js → main.js
```

| File        | Responsibility                                   | DOM Access |
| ----------- | ------------------------------------------------ | ---------- |
| `config.js` | Balance constants, game content definitions      | No         |
| `state.js`  | `GameState` object + localStorage I/O            | No         |
| `logic.js`  | Pure game rules, returns `{ ok, reason }`        | No         |
| `scene.js`  | Canvas rendering, ship animations (IIFE `Scene`) | Yes        |
| `ui.js`     | DOM widgets, events, toasts (IIFE `UI`)          | Yes        |
| `main.js`   | Boot, 1s tick loop, orchestration                | Minimal    |

## Critical Patterns

### 1. No hardcoded values in UI/scene code

All game balance lives in `config.js`. Never hardcode numbers like mission times, prices, or yields in `ui.js` or `scene.js`.

```javascript
// WRONG
const miningTime = 300000;

// RIGHT
MISSIONS[materialId].miningMs;
```

### 2. Timestamp-driven missions (offline progress)

Mission phase is **derived**, never stored as mutable state:

```javascript
// logic.js — missionPhase()
if (now < mission.outboundEndsAt) return 'departing';
if (now < mission.miningEndsAt) return 'mining';
if (now < mission.returnEndsAt) return 'returning';
return 'complete';
```

This allows missions to progress while tab is closed.

### 3. Result objects for mutations

Functions that modify state return `{ ok: true }` or `{ ok: false, reason: "..." }`:

```javascript
const result = startMission('ferriteOre');
if (!result.ok) {
  UI.showToast(result.reason, 'error');
}
```

### 4. IIFE module pattern

`Scene` and `UI` are IIFEs exposing public APIs:

```javascript
const Scene = (() => {
  // private state and functions
  return { focusShip }; // everything else is derived per-frame from GameState
})();
```

### 5. Star-cluster map

The whole map (home system + mining systems) is defined in `STAR_SYSTEMS` in `config.js` — sun position/palette, orbiting bodies, asteroid belt and its resource. `scene.js` renders it through a world-coordinate camera: drag pans, wheel/pinch zooms, `Scene.focusShip()` returns to auto-follow (which also does the cinematic zoom out/in around missions). Ship position is derived from mission timestamps every frame — never stored.

### 6. Render strategy

- `UI.renderAll()` — full render on major state changes
- `UI.renderTopBar()`, `UI.updateActiveMission()` — partial updates in tick loop (preserves form inputs)

## Key Globals

- `GameState` — the game state object
- `MATERIALS` — material definitions (ferriteOre, cobaltCrystal, voidShard)
- `MISSIONS` — mission configs with timings/yields
- `STAR_SYSTEMS` — the cluster map: suns, orbiting bodies, belts/resources
- `COURIER_TIERS` — courier contract definitions
- `UPGRADE_COSTS` — ship upgrade requirements
- `Scene` — canvas/ship visual controller
- `UI` — DOM rendering/events controller

## GameState Shape

```javascript
{
  version: 1,
  player: {
    credits: number,
    inventory: { ferriteOre, cobaltCrystal, voidShard },
    ship: { drillLevel, cargoLevel, reactorLevel }  // 1-3
  },
  market: { [materialId]: { buyPrice, sellPrice } },
  courierOffers: [...],  // always 3
  currentMission: null | {
    id, materialId, type,
    targetSystemId,             // mining: STAR_SYSTEMS key (random per resource)
    destPos,                    // courier: off-map waypoint {x, y}
    outboundEndsAt, miningEndsAt, returnEndsAt  // timestamps
  },
  eventLog: [...],
  selectedPanel: "mine" | "market" | "upgrade",
  selectedShipPart: null | "drill" | "cargo" | "reactor"
}
```

## Persistence

- Key: `spaceOddity.save.v1`
- `saveState()` after mutations
- `loadState()` merges saved data over `defaultGameState()` for forward compatibility

## Common Mistakes to Avoid

1. **Adding npm/build tools** — This is intentionally vanilla JS with no build step
2. **Using ES modules** — Scripts use globals; load order in index.html matters
3. **Storing phase as state** — Phase is derived from timestamps, never stored
4. **Direct DOM manipulation in logic.js** — Keep logic pure; DOM goes in ui.js
5. **Hardcoding balance values** — Everything tunable goes in config.js
6. **Forgetting to call saveState()** — After any state mutation
7. **Breaking the tick loop** — `main.js` tick() runs every 1s; don't block it

## Testing

Manual only. Use debug buttons:

- **SKIP 1 MIN** — Fast-forward time
- **RESET GAME** — Clear localStorage

## File Locations

```
space-oddity/
├── index.html      # HTML shell, HUD layout, inline ship SVG
├── css/hud.css     # Retro HUD theme, grid, animations
└── js/
    ├── config.js   # Game balance/content
    ├── state.js    # State + persistence
    ├── logic.js    # Game rules
    ├── scene.js    # Canvas/visuals
    ├── ui.js       # DOM/events
    └── main.js     # Entry point, tick loop
```

### Conventions

- Do not add playwright tests, fuck that shit.
- Do not add external dependencies unless I explicitly tell you to
