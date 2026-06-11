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
  },
  cobaltCrystal: {
    name: "Mine Cobalt Crystal",
    requiredDrillLevel: 2,
    baseOutboundSeconds: 45,
    baseMiningSeconds: 480,
    baseReturnSeconds: 45,
    fuelCost: 35,
    baseYield: 35,
  },
  voidShard: {
    name: "Mine Void Shard",
    requiredDrillLevel: 3,
    baseOutboundSeconds: 60,
    baseMiningSeconds: 720,
    baseReturnSeconds: 60,
    fuelCost: 75,
    baseYield: 25,
  },
};

// ---------- star cluster map ----------
// Single source of truth for the map. Positions are world units
// (the camera projects them to pixels), so moving a system is just
// editing its pos. Each system defines its sun (position, radius,
// palette), the bodies orbiting it, and — for mining systems — the
// resource its asteroid belt yields. Several systems may share a
// resource; missions pick one of them at random.
//
// body props: dist = orbit radius (world units), speed = rad/ms,
// phase = starting angle, r = body radius, c1/c2 = shading colors,
// ring = draw a planetary ring, home = the station orbits with it.

const HOME_SYSTEM_ID = "helios";
const HOME_STATION_NAME = "ASTERION STATION";

const STAR_SYSTEMS = {
  helios: {
    name: "HELIOS",
    pos: { x: 0, y: 0 },
    resource: null,
    star: { r: 42, core0: "#fff7e0", core1: "#ffd76a", core2: "#ff9330", halo: "255, 180, 80" },
    bodies: [
      { name: "CINDER",  dist: 95,  speed: 0.00010,  phase: 2.1, r: 5,  c1: "#e0b070", c2: "#6a4520" },
      { name: "FERROS",  dist: 160, speed: 0.00006,  phase: 4.6, r: 8,  c1: "#c97b54", c2: "#46241a" },
      { name: "VANTH",   dist: 235, speed: 0.00003,  phase: 3.8, r: 11, c1: "#8a68b8", c2: "#241440", ring: true },
      // home planet — Asterion Station (and the docked ship) orbit with it
      { name: "AURELIA", dist: 320, speed: 0.000016, phase: 1.3, r: 15, c1: "#4a86c8", c2: "#0e1c33", home: true },
    ],
  },
  korvax: {
    name: "KORVAX",
    pos: { x: 2200, y: -1250 },
    resource: "ferriteOre",
    star: { r: 36, core0: "#fff7e0", core1: "#ffd76a", core2: "#ff9330", halo: "255, 180, 80" },
    belt: { dist: 240, count: 36, colors: ["#8a939e", "#6b6f76", "#56524c"] },
    bodies: [
      { name: "EMBERSHALE",  dist: 95,  speed: 0.000055, phase: 1.7, r: 5,  c1: "#e8c090", c2: "#5a3a20" },
      { name: "ANVIL",       dist: 155, speed: 0.000038, phase: 4.3, r: 8,  c1: "#b07a5a", c2: "#3c241c", ring: true },
      { name: "BRIMSTONE",   dist: 215, speed: 0.000028, phase: 0.9, r: 6,  c1: "#d8b287", c2: "#5e4426" },
      { name: "CINDERWAKE",  dist: 310, speed: 0.000018, phase: 3.1, r: 12, c1: "#8a7060", c2: "#2a2018" },
    ],
  },
  draban: {
    name: "DRABAN",
    pos: { x: -1450, y: -2250 },
    resource: "ferriteOre",
    star: { r: 26, core0: "#ffe9d6", core1: "#ff9a6a", core2: "#cf4a18", halo: "255, 130, 80" },
    belt: { dist: 190, count: 30, colors: ["#9aa3ad", "#7d7368", "#5c5f66"] },
    bodies: [
      { name: "EMBERFALL",  dist: 85,  speed: 0.000048, phase: 0.6, r: 5,  c1: "#e0a878", c2: "#4a2e1c" },
      { name: "CINNABAR",   dist: 130, speed: 0.000036, phase: 2.8, r: 7,  c1: "#c87858", c2: "#3a2010" },
      { name: "SLAGRIFT",   dist: 175, speed: 0.000030, phase: 5.4, r: 6,  c1: "#caa27e", c2: "#4a2e1c" },
      { name: "RUSTMOOR",   dist: 255, speed: 0.000020, phase: 1.2, r: 10, c1: "#9a7868", c2: "#302018", ring: true },
    ],
  },
  cryos: {
    name: "CRYOS",
    pos: { x: 3050, y: 1150 },
    resource: "cobaltCrystal",
    star: { r: 40, core0: "#f0fbff", core1: "#9fd8ff", core2: "#4a90e0", halo: "120, 190, 255" },
    belt: { dist: 250, count: 34, colors: ["#4db8ff", "#2b5f8f", "#27496b"] },
    bodies: [
      { name: "RIMEPOINT",  dist: 100, speed: 0.000048, phase: 0.8, r: 5,  c1: "#d8f0ff", c2: "#1a3550" },
      { name: "GLACIERA",   dist: 165, speed: 0.000032, phase: 3.5, r: 8,  c1: "#bfe8ff", c2: "#1d3f63" },
      { name: "FROSTVEIL",  dist: 225, speed: 0.000024, phase: 5.7, r: 10, c1: "#6fb4e8", c2: "#102a44", ring: true },
      { name: "DEEPAZURE",  dist: 320, speed: 0.000016, phase: 2.2, r: 13, c1: "#4a90c8", c2: "#0a1a30" },
    ],
  },
  thule: {
    name: "THULE",
    pos: { x: -3000, y: 950 },
    resource: "cobaltCrystal",
    star: { r: 32, core0: "#f4ffff", core1: "#bfeaf0", core2: "#5aa8c0", halo: "140, 220, 235" },
    belt: { dist: 210, count: 30, colors: ["#6fb4e8", "#2b5f8f", "#1f3a56"] },
    bodies: [
      { name: "WHITENOSE",   dist: 90,  speed: 0.000052, phase: 5.2, r: 5,  c1: "#eef8fc", c2: "#2a4a5a" },
      { name: "PERMAFROST",  dist: 140, speed: 0.000034, phase: 2.0, r: 7,  c1: "#d8eef5", c2: "#23445a" },
      { name: "SHIVARA",     dist: 195, speed: 0.000026, phase: 4.1, r: 8,  c1: "#88b8cc", c2: "#142e3e" },
      { name: "NIGHTFROST",  dist: 275, speed: 0.000018, phase: 0.5, r: 11, c1: "#5a90a8", c2: "#0e2030", ring: true },
    ],
  },
  erebus: {
    name: "EREBUS",
    pos: { x: 550, y: 3300 },
    resource: "voidShard",
    star: { r: 46, core0: "#f4e8ff", core1: "#c89aff", core2: "#7a3ad0", halo: "160, 100, 255" },
    belt: { dist: 280, count: 38, colors: ["#b86bff", "#3a2454", "#46306b"] },
    bodies: [
      { name: "TWILIGHT",     dist: 110, speed: 0.000044, phase: 2.4, r: 6,  c1: "#d8b0ff", c2: "#2a1646" },
      { name: "SHADEWROUGHT", dist: 175, speed: 0.000030, phase: 5.1, r: 9,  c1: "#c9a0ff", c2: "#2a1646" },
      { name: "UMBRAL",       dist: 245, speed: 0.000022, phase: 1.8, r: 11, c1: "#7a55b0", c2: "#170b2c", ring: true },
      { name: "VOIDMIRE",     dist: 350, speed: 0.000014, phase: 4.6, r: 14, c1: "#5a3888", c2: "#0a0618" },
    ],
  },
};

// Isometric squash for orbital body positions (shared by logic + scene).
const MAP_ISO_SQUASH = 0.36;

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

const MAX_LOG_LINES = 8;
