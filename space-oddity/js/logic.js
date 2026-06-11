// =====================================================
// GAME LOGIC — missions, market, upgrades.
// Pure-ish functions over GameState; no DOM access here.
// =====================================================

// ---------- helpers ----------

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function cargoCapacity() {
  return CARGO_CAPACITY_BY_LEVEL[GameState.player.ship.cargoLevel];
}

function reactorMultiplier() {
  return REACTOR_MULTIPLIER_BY_LEVEL[GameState.player.ship.reactorLevel];
}

function unlockedMaterials() {
  return DRILL_UNLOCKS_BY_LEVEL[GameState.player.ship.drillLevel];
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return s + "s";
  if (s === 0) return m + "m";
  return m + "m " + s + "s";
}

// ---------- missions ----------

// All systems whose asteroid belt yields the given material.
function systemsForMaterial(materialId) {
  return Object.keys(STAR_SYSTEMS).filter((id) => STAR_SYSTEMS[id].resource === materialId);
}

// Saved missions from before the cluster map have no targetSystemId.
function missionTargetSystemId(mission) {
  if (mission.targetSystemId && STAR_SYSTEMS[mission.targetSystemId]) return mission.targetSystemId;
  return systemsForMaterial(mission.materialId)[0] || HOME_SYSTEM_ID;
}

// All non-home planets that courier contracts can deliver to.
function courierPlanets() {
  const planets = [];
  for (const [systemId, sys] of Object.entries(STAR_SYSTEMS)) {
    (sys.bodies || []).forEach((body, bodyIdx) => {
      if (body.home) return;
      planets.push({
        systemId,
        bodyIdx,
        name: body.name,
        systemName: sys.name,
      });
    });
  }
  return planets;
}

function planetWorldPos(systemId, bodyIdx, t) {
  const sys = STAR_SYSTEMS[systemId];
  const body = sys.bodies[bodyIdx];
  const a = body.phase + t * body.speed;
  return {
    x: sys.pos.x + Math.cos(a) * body.dist,
    y: sys.pos.y + Math.sin(a) * body.dist * MAP_ISO_SQUASH,
  };
}

// Docking point just outside the planet's surface, facing away from the sun.
function courierPlanetPos(mission, t) {
  if (mission.targetSystemId != null && mission.targetBodyIdx != null) {
    const sys = STAR_SYSTEMS[mission.targetSystemId];
    const body = sys.bodies[mission.targetBodyIdx];
    const p = planetWorldPos(mission.targetSystemId, mission.targetBodyIdx, t);
    const dx = p.x - sys.pos.x;
    const dy = p.y - sys.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const pad = body.r + 18;
    return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
  }
  // legacy saves that still have an off-map waypoint
  if (mission.destPos) return mission.destPos;
  return { x: 0, y: 0 };
}

function courierDestPos(mission, t) {
  return courierPlanetPos(mission, t ?? Date.now());
}

function missionDurations(materialId) {
  const cfg = MISSIONS[materialId];
  const mult = reactorMultiplier();
  return {
    outboundMs: cfg.baseOutboundSeconds * mult * 1000,
    miningMs: cfg.baseMiningSeconds * mult * 1000,
    returnMs: cfg.baseReturnSeconds * mult * 1000,
  };
}

function missionTotalSeconds(materialId) {
  const d = missionDurations(materialId);
  return (d.outboundMs + d.miningMs + d.returnMs) / 1000;
}

function canStartMission(materialId) {
  const cfg = MISSIONS[materialId];
  if (GameState.currentMission) return { ok: false, reason: "Mission already active" };
  if (GameState.player.ship.drillLevel < cfg.requiredDrillLevel)
    return { ok: false, reason: "Requires Drill Level " + cfg.requiredDrillLevel };
  if (GameState.player.credits < cfg.fuelCost)
    return { ok: false, reason: "Not enough credits for fuel" };
  return { ok: true };
}

function startMission(materialId) {
  const check = canStartMission(materialId);
  if (!check.ok) return check;

  const cfg = MISSIONS[materialId];
  const d = missionDurations(materialId);
  const now = Date.now();
  const targetSystemId = pickRandom(systemsForMaterial(materialId));

  GameState.player.credits -= cfg.fuelCost;
  GameState.currentMission = {
    id: "m_" + now,
    materialId,
    status: "departing",
    startedAt: now,
    outboundEndsAt: now + d.outboundMs,
    miningEndsAt: now + d.outboundMs + d.miningMs,
    returnEndsAt: now + d.outboundMs + d.miningMs + d.returnMs,
    completedAt: 0,
    fuelCost: cfg.fuelCost,
    expectedYield: Math.min(cfg.baseYield, cargoCapacity()),
    targetSystemId,
  };

  logEvent("Mission started: " + cfg.name + ".");
  logEvent("Ship departed for the " + STAR_SYSTEMS[targetSystemId].name +
    " system. Fuel: -" + cfg.fuelCost + " cr.");
  saveState();
  return { ok: true };
}

// ---------- courier contracts ----------

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCourierOffer() {
  const tier = randInt(1, 3);
  const cfg = COURIER_TIERS[tier];
  const jitter = 1 + (Math.random() * 2 - 1) * COURIER_TIME_JITTER;
  const planet = pickRandom(courierPlanets());
  return {
    id: "c_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
    tier,
    destination: planet.name + ", " + planet.systemName + " System",
    targetSystemId: planet.systemId,
    targetBodyIdx: planet.bodyIdx,
    cargo: pickRandom(COURIER_CARGO_TYPES),
    durationSeconds: Math.round(cfg.baseSeconds * jitter),
    fuelCost: cfg.fuelCost,
    rewardCredits: randInt(cfg.minCredits, cfg.maxCredits),
    rewardMaterialId: cfg.materialId,
    rewardMaterialQty: randInt(cfg.minMaterials, cfg.maxMaterials),
  };
}

function ensureCourierOffers() {
  if (!Array.isArray(GameState.courierOffers)) GameState.courierOffers = [];
  GameState.courierOffers = GameState.courierOffers.map((offer) => {
    if (offer.targetSystemId != null) return offer;
    const planet = pickRandom(courierPlanets());
    return {
      ...offer,
      destination: planet.name + ", " + planet.systemName + " System",
      targetSystemId: planet.systemId,
      targetBodyIdx: planet.bodyIdx,
    };
  });
  while (GameState.courierOffers.length < COURIER_OFFER_COUNT) {
    GameState.courierOffers.push(generateCourierOffer());
  }
}

function canStartCourier(offer) {
  if (GameState.currentMission) return { ok: false, reason: "Mission already active" };
  if (GameState.player.ship.cargoLevel < offer.tier)
    return { ok: false, reason: "Requires Cargo Bay Level " + offer.tier };
  if (GameState.player.credits < offer.fuelCost)
    return { ok: false, reason: "Not enough credits for fuel" };
  return { ok: true };
}

function startCourierMission(offerId) {
  const offer = GameState.courierOffers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: "Contract no longer available" };
  const check = canStartCourier(offer);
  if (!check.ok) return check;

  const now = Date.now();
  const durationMs = offer.durationSeconds * reactorMultiplier() * 1000;
  const endsAt = now + durationMs;

  GameState.player.credits -= offer.fuelCost;
  GameState.currentMission = {
    id: "m_" + now,
    type: "courier",
    status: "travelling",
    startedAt: now,
    // outbound/mining mirror the end so debug skip and old helpers stay safe
    outboundEndsAt: endsAt,
    miningEndsAt: endsAt,
    returnEndsAt: endsAt,
    completedAt: 0,
    fuelCost: offer.fuelCost,
    destination: offer.destination,
    targetSystemId: offer.targetSystemId,
    targetBodyIdx: offer.targetBodyIdx,
    cargo: offer.cargo,
    rewardCredits: offer.rewardCredits,
    rewardMaterialId: offer.rewardMaterialId,
    rewardMaterialQty: offer.rewardMaterialQty,
  };

  // replace the taken contract so the board stays full
  GameState.courierOffers = GameState.courierOffers.filter((o) => o.id !== offerId);
  ensureCourierOffers();

  logEvent("Courier contract accepted: " + offer.cargo + " → " + offer.destination + ".");
  logEvent("Ship departed for " + offer.destination + ". Fuel: -" + offer.fuelCost + " cr.");
  saveState();
  return { ok: true };
}

// Phase is always derived from timestamps so refresh/restore works.
function missionPhase(mission, now) {
  if (!mission) return null;
  if (mission.type === "courier") {
    return now < mission.returnEndsAt ? "travelling" : "complete";
  }
  if (now < mission.outboundEndsAt) return "departing";
  if (now < mission.miningEndsAt) return "mining";
  if (now < mission.returnEndsAt) return "returning";
  return "complete";
}

// Cargo units mined so far (0 during departure, full during return).
function missionCargoProgress(mission, now) {
  if (!mission) return 0;
  const phase = missionPhase(mission, now);
  if (phase === "departing") return 0;
  if (phase === "mining") {
    const frac = (now - mission.outboundEndsAt) / (mission.miningEndsAt - mission.outboundEndsAt);
    return Math.floor(mission.expectedYield * clamp(frac, 0, 1));
  }
  return mission.expectedYield;
}

function missionTimeRemaining(mission, now) {
  const phase = missionPhase(mission, now);
  if (phase === "departing") return mission.outboundEndsAt - now;
  if (phase === "mining") return mission.miningEndsAt - now;
  if (phase === "returning" || phase === "travelling") return mission.returnEndsAt - now;
  return 0;
}

// Returns the completed mission (for UI toast) or null.
function completeMissionIfDone(now) {
  const mission = GameState.currentMission;
  if (!mission || missionPhase(mission, now) !== "complete") return null;

  mission.completedAt = now;
  if (mission.type === "courier") {
    GameState.player.credits += mission.rewardCredits;
    GameState.player.inventory[mission.rewardMaterialId] += mission.rewardMaterialQty;
    logEvent("Delivery to " + mission.destination + " complete: +" + mission.rewardCredits +
      " cr, +" + mission.rewardMaterialQty + " " + MATERIALS[mission.rewardMaterialId].name + ".");
  } else {
    GameState.player.inventory[mission.materialId] += mission.expectedYield;
    const mat = MATERIALS[mission.materialId];
    logEvent("Mission complete: +" + mission.expectedYield + " " + mat.name + ".");
  }
  GameState.currentMission = null;
  saveState();
  return mission;
}

// Human-readable location for the top bar, derived from mission phase.
function currentLocationName(now) {
  const mission = GameState.currentMission;
  if (!mission) return "Asterion Station";
  const phase = missionPhase(mission, now);
  if (phase === "complete") return "Asterion Station";
  if (mission.type === "courier") return mission.destination;
  const sys = STAR_SYSTEMS[missionTargetSystemId(mission)];
  if (phase === "departing") return "In Transit — " + sys.name + " System";
  if (phase === "mining") return sys.name + " System";
  return "In Transit — Asterion Station";
}

// ---------- market ----------

function enforcePriceBounds(materialId) {
  const m = GameState.market[materialId];
  const b = MARKET_BOUNDS[materialId];
  m.buyPrice = clamp(m.buyPrice, b.minBuyPrice, b.maxBuyPrice);
  m.sellPrice = clamp(m.sellPrice, b.minSellPrice, b.maxSellPrice);
  // NPC sell price must stay above NPC buy price
  m.sellPrice = Math.max(m.sellPrice, m.buyPrice * MARKET_MIN_SPREAD_RATIO);
  m.sellPrice = Math.min(m.sellPrice, b.maxSellPrice);
  // round to one decimal for display sanity
  m.buyPrice = Math.round(m.buyPrice * 10) / 10;
  m.sellPrice = Math.round(m.sellPrice * 10) / 10;
}

// direction: +1 player bought (demand up), -1 player sold (supply up)
function adjustMarketPrices(materialId, quantity, direction) {
  const change = clamp(quantity * MARKET_PRICE_CHANGE_PER_UNIT, 0, MARKET_MAX_CHANGE_PER_TRADE);
  const m = GameState.market[materialId];
  m.buyPrice *= 1 + direction * change;
  m.sellPrice *= 1 + direction * change;
  enforcePriceBounds(materialId);
}

function sellMaterial(materialId, quantity) {
  if (GameState.currentMission) return { ok: false, reason: "Trading is only available while docked" };
  quantity = Math.floor(quantity);
  if (quantity <= 0) return { ok: false, reason: "Quantity must be positive" };
  const inv = GameState.player.inventory;
  if (inv[materialId] < quantity) return { ok: false, reason: "Not enough " + MATERIALS[materialId].name };

  const total = Math.round(GameState.market[materialId].buyPrice * quantity);
  inv[materialId] -= quantity;
  GameState.player.credits += total;
  adjustMarketPrices(materialId, quantity, -1);

  logEvent("Sold " + quantity + " " + MATERIALS[materialId].name + " for " + total + " cr.");
  saveState();
  return { ok: true, total };
}

function buyMaterial(materialId, quantity) {
  if (GameState.currentMission) return { ok: false, reason: "Trading is only available while docked" };
  quantity = Math.floor(quantity);
  if (quantity <= 0) return { ok: false, reason: "Quantity must be positive" };
  const total = Math.round(GameState.market[materialId].sellPrice * quantity);
  if (GameState.player.credits < total) return { ok: false, reason: "Not enough credits" };

  GameState.player.credits -= total;
  GameState.player.inventory[materialId] += quantity;
  adjustMarketPrices(materialId, quantity, +1);

  logEvent("Bought " + quantity + " " + MATERIALS[materialId].name + " for " + total + " cr.");
  saveState();
  return { ok: true, total };
}

// ---------- upgrades ----------

function partLevel(part) {
  return GameState.player.ship[part + "Level"];
}

function canUpgrade(part) {
  const lvl = partLevel(part);
  if (lvl >= 3) return { ok: false, reason: "Already at max level" };
  if (GameState.currentMission) return { ok: false, reason: "Cannot upgrade during a mission" };

  const cost = UPGRADES[part].levels[lvl + 1];
  if (GameState.player.credits < cost.credits)
    return { ok: false, reason: "Not enough credits" };
  for (const [mat, qty] of Object.entries(cost.materials)) {
    if (GameState.player.inventory[mat] < qty)
      return { ok: false, reason: "Not enough " + MATERIALS[mat].name };
  }
  return { ok: true, cost };
}

function upgradePart(part) {
  const check = canUpgrade(part);
  if (!check.ok) return check;

  const cost = check.cost;
  GameState.player.credits -= cost.credits;
  for (const [mat, qty] of Object.entries(cost.materials)) {
    GameState.player.inventory[mat] -= qty;
  }
  GameState.player.ship[part + "Level"] += 1;

  logEvent(UPGRADES[part].name + " upgraded to Level " + partLevel(part) + ".");
  saveState();
  return { ok: true };
}
