// =====================================================
// GAME BALANCE CONFIG — all tunables live here.
// No game balance values should be hardcoded in UI code.
// =====================================================

const MATERIALS = {
  ferriteOre: {
    name: "Ferrite Ore",
    tier: 1,
    color: "#9aa3ad",
    icon: "▰",
  },
  cobaltCrystal: {
    name: "Cobalt Crystal",
    tier: 2,
    color: "#4db8ff",
    icon: "◆",
  },
  voidShard: {
    name: "Void Shard",
    tier: 3,
    color: "#b86bff",
    icon: "✦",
  },
};

const MATERIAL_IDS = ["ferriteOre", "cobaltCrystal", "voidShard"];

const CARGO_CAPACITY_BY_LEVEL = { 1: 50, 2: 100, 3: 175 };

const REACTOR_MULTIPLIER_BY_LEVEL = { 1: 1.0, 2: 0.8, 3: 0.6 };

// Which materials each drill level can mine
const DRILL_UNLOCKS_BY_LEVEL = {
  1: ["ferriteOre"],
  2: ["ferriteOre", "cobaltCrystal"],
  3: ["ferriteOre", "cobaltCrystal", "voidShard"],
};

const MISSIONS = {
  ferriteOre: {
    name: "Mine Ferrite Ore",
    requiredDrillLevel: 1,
    baseOutboundSeconds: 30,
    baseMiningSeconds: 300,
    baseReturnSeconds: 30,
    fuelCost: 15,
    baseYield: 40,
    targetScene: "asteroidField",
    sceneName: "Asteroid Field",
  },
  cobaltCrystal: {
    name: "Mine Cobalt Crystal",
    requiredDrillLevel: 2,
    baseOutboundSeconds: 45,
    baseMiningSeconds: 480,
    baseReturnSeconds: 45,
    fuelCost: 35,
    baseYield: 35,
    targetScene: "crystalField",
    sceneName: "Crystal Field",
  },
  voidShard: {
    name: "Mine Void Shard",
    requiredDrillLevel: 3,
    baseOutboundSeconds: 60,
    baseMiningSeconds: 720,
    baseReturnSeconds: 60,
    fuelCost: 75,
    baseYield: 25,
    targetScene: "voidField",
    sceneName: "Void Nebula",
  },
};

// ---------- courier contracts ----------
// Dynamically generated money runs. The ship travels the whole
// time (no mining phase); duration ≈ 2x the same-tier mining
// mission. Pays mostly credits plus a few materials.

const COURIER_OFFER_COUNT = 3;
const COURIER_TIME_JITTER = 0.15; // ±15% duration variance per contract

// Tier is gated by Cargo Bay level (bigger holds, bigger freight).
// baseSeconds = 2x the total base time of the same-tier mining mission.
const COURIER_TIERS = {
  1: { baseSeconds: 720,  fuelCost: 20, minCredits: 300,  maxCredits: 420,
       materialId: "ferriteOre",    minMaterials: 4, maxMaterials: 10 },
  2: { baseSeconds: 1140, fuelCost: 45, minCredits: 700,  maxCredits: 950,
       materialId: "cobaltCrystal", minMaterials: 4, maxMaterials: 9 },
  3: { baseSeconds: 1680, fuelCost: 90, minCredits: 1500, maxCredits: 2000,
       materialId: "voidShard",     minMaterials: 3, maxMaterials: 7 },
};

const COURIER_DESTINATIONS = [
  "Outpost Meridian", "Kepler Relay", "Port Caldera", "Nyx Terminal",
  "Halcyon Depot", "Vesta Beacon", "Tycho Gate", "Oberon Yards",
  "Cygnus Waystation", "Drift Colony 7",
];

const COURIER_CARGO_TYPES = [
  "Medical Supplies", "Station Spare Parts", "Encrypted Data Cores",
  "Hydroponic Seed Vault", "Refined Fuel Cells", "Colonist Mail",
  "Scientific Instruments", "Luxury Rations",
];

const MARKET_START = {
  ferriteOre: { buyPrice: 4, sellPrice: 6 },
  cobaltCrystal: { buyPrice: 14, sellPrice: 20 },
  voidShard: { buyPrice: 45, sellPrice: 65 },
};

const MARKET_BOUNDS = {
  ferriteOre: { minBuyPrice: 2, maxBuyPrice: 8, minSellPrice: 3, maxSellPrice: 12 },
  cobaltCrystal: { minBuyPrice: 8, maxBuyPrice: 28, minSellPrice: 12, maxSellPrice: 40 },
  voidShard: { minBuyPrice: 28, maxBuyPrice: 90, minSellPrice: 40, maxSellPrice: 130 },
};

const MARKET_PRICE_CHANGE_PER_UNIT = 0.002; // 0.2% per unit traded
const MARKET_MAX_CHANGE_PER_TRADE = 0.08;   // clamp to 8%
const MARKET_MIN_SPREAD_RATIO = 1.25;       // sellPrice >= buyPrice * 1.25

const UPGRADES = {
  drill: {
    name: "Drill System",
    bonusLabel: (lvl) =>
      "Access: " + DRILL_UNLOCKS_BY_LEVEL[lvl].map((m) => MATERIALS[m].name).join(", "),
    levels: {
      2: { credits: 300, materials: { ferriteOre: 80 }, unlocks: "Unlocks Cobalt Crystal mining" },
      3: { credits: 900, materials: { ferriteOre: 150, cobaltCrystal: 80 }, unlocks: "Unlocks Void Shard mining" },
    },
  },
  cargo: {
    name: "Cargo Bay",
    bonusLabel: (lvl) => "Capacity: " + CARGO_CAPACITY_BY_LEVEL[lvl] + " units",
    levels: {
      2: { credits: 250, materials: { ferriteOre: 60 }, unlocks: "Capacity 50 → 100 units" },
      3: { credits: 700, materials: { ferriteOre: 120, cobaltCrystal: 50 }, unlocks: "Capacity 100 → 175 units" },
    },
  },
  reactor: {
    name: "Reactor Core",
    bonusLabel: (lvl) => "Time multiplier: " + REACTOR_MULTIPLIER_BY_LEVEL[lvl].toFixed(2) + "x",
    levels: {
      2: { credits: 400, materials: { ferriteOre: 100, cobaltCrystal: 20 }, unlocks: "Mission time 1.00x → 0.80x" },
      3: { credits: 1100, materials: { ferriteOre: 150, cobaltCrystal: 80, voidShard: 20 }, unlocks: "Mission time 0.80x → 0.60x" },
    },
  },
};

const STARTING_CREDITS = 250;

const SCENE_NAMES = {
  station: "Asterion Station",
  transit: "Deep Space — In Transit",
  asteroidField: "Asteroid Field",
  crystalField: "Crystal Field",
  voidField: "Void Nebula",
};

const MAX_LOG_LINES = 8;
