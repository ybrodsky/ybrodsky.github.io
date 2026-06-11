// =====================================================
// MAIN — boot, game tick, phase/scene reconciliation.
// Mission progress is always derived from timestamps,
// so refreshing mid-mission reconstructs everything.
// =====================================================

let lastPhase = null;

function syncSceneToState(animate) {
  const now = Date.now();
  const target = deriveScene(now);
  GameState.currentScene = target;
  Scene.setScene(target, animate);

  const mission = GameState.currentMission;
  if (!mission) {
    Scene.setShipMode("docked");
  } else {
    const phase = missionPhase(mission, now);
    Scene.setShipMode(phase === "mining" ? "mining" : "flying");
  }
}

function tick() {
  const now = Date.now();
  const mission = GameState.currentMission;
  const phase = missionPhase(mission, now);

  // phase transition?
  if (phase !== lastPhase) {
    lastPhase = phase;

    if (mission && phase === "mining") {
      logEvent("Arrived at " + MISSIONS[mission.materialId].sceneName + ". Mining commenced.");
    } else if (mission && phase === "returning") {
      logEvent("Cargo hold secured. Returning to Asterion Station.");
    }
    syncSceneToState(true);
    UI.renderAll();
  }

  // mission completion
  if (mission && phase === "complete" && !Scene.isTransitioning()) {
    const done = completeMissionIfDone(now);
    if (done) {
      if (done.type === "courier") {
        const mat = MATERIALS[done.rewardMaterialId];
        UI.showToast(`
          <div class="toast-title accent-green">DELIVERY COMPLETE</div>
          <div>+${done.rewardCredits} cr · <span class="mat-icon" style="color:${mat.color}">${mat.icon}</span>
            +${done.rewardMaterialQty} ${mat.name}</div>
          <div class="hint">Fuel spent: ${done.fuelCost} cr</div>`);
      } else {
        const mat = MATERIALS[done.materialId];
        UI.showToast(`
          <div class="toast-title accent-green">MISSION COMPLETE</div>
          <div><span class="mat-icon" style="color:${mat.color}">${mat.icon}</span>
            +${done.expectedYield} ${mat.name}</div>
          <div class="hint">Fuel spent: ${done.fuelCost} cr</div>`);
      }
      lastPhase = null;
      syncSceneToState(true);
      UI.renderAll();
    }
  }

  // lightweight live updates every tick
  UI.renderTopBar(now);
  UI.updateActiveMission(now);
}

function boot() {
  GameState = loadState();

  // Reconcile a mission that may have progressed (or finished) while
  // the page was closed.
  const now = Date.now();
  const mission = GameState.currentMission;
  if (mission && missionPhase(mission, now) === "complete") {
    const done = completeMissionIfDone(now);
    if (done) {
      if (done.type === "courier") {
        UI.showToast(`
          <div class="toast-title accent-green">DELIVERY COMPLETED WHILE AWAY</div>
          <div>+${done.rewardCredits} cr · +${done.rewardMaterialQty} ${MATERIALS[done.rewardMaterialId].name}</div>`);
      } else {
        const mat = MATERIALS[done.materialId];
        UI.showToast(`
          <div class="toast-title accent-green">MISSION COMPLETED WHILE AWAY</div>
          <div>+${done.expectedYield} ${mat.name}</div>`);
      }
    }
  }
  ensureCourierOffers();
  lastPhase = missionPhase(GameState.currentMission, now);

  UI.bindEvents();
  syncSceneToState(false);
  UI.renderAll();
  saveState();

  setInterval(tick, 1000);
}

boot();
