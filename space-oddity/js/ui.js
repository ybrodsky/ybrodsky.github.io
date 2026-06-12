// =====================================================
// UI RENDERING — widgets, tabs, live updates, toasts.
// Static panels render on demand; tick() only touches
// live text nodes so inputs are never wiped.
// =====================================================

const UI = (() => {
  const el = (id) => document.getElementById(id);

  // ---------- mobile bottom-sheet drawers ----------
  // Only visible under the mobile media query; on desktop the attribute
  // is inert (the panels keep their grid positions).

  function syncNav(name) {
    document.querySelectorAll('#mobile-nav .mnav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.sheet === name);
    });
  }

  function openSheet(name) {
    document.body.dataset.mobileSheet = name;
    syncNav(name);
  }

  function toggleSheet(name) {
    openSheet(document.body.dataset.mobileSheet === name ? '' : name);
  }

  // ---------- top bar ----------

  function renderTopBar(now) {
    el('top-credits').textContent = GameState.player.credits + ' cr';
    el('top-location').textContent = currentLocationName(now);

    const mission = GameState.currentMission;
    const statusEl = el('top-status');
    const timerEl = el('top-timer');
    if (!mission) {
      statusEl.textContent = 'Docked';
      statusEl.className = 'value accent-green';
      timerEl.textContent = '';
      return;
    }
    const phase = missionPhase(mission, now);
    if (mission.type === 'courier') {
      statusEl.textContent =
        phase === 'complete'
          ? 'Docking…'
          : 'Courier Run — ' + mission.destination;
    } else {
      const sysName = STAR_SYSTEMS[missionTargetSystemId(mission)].name;
      const labels = {
        departing: 'Outbound — ' + sysName + ' System',
        mining: 'Mining ' + MATERIALS[mission.materialId].name,
        returning: 'Returning to Station',
        complete: 'Docking…',
      };
      statusEl.textContent = labels[phase];
    }
    statusEl.className = 'value accent-orange';
    timerEl.textContent =
      formatTime(missionTimeRemaining(mission, now)) + ' remaining';
  }

  // ---------- left widgets ----------

  function renderShipStatus() {
    const ship = GameState.player.ship;
    el('ship-status-body').innerHTML = `
      <div class="stat-row"><span>Drill</span><span class="accent-cyan">Lv ${ship.drillLevel}</span></div>
      <div class="stat-row"><span>Cargo</span><span class="accent-orange">Lv ${ship.cargoLevel} — ${cargoCapacity()} units</span></div>
      <div class="stat-row"><span>Reactor</span><span class="accent-green">Lv ${ship.reactorLevel} — ${reactorMultiplier().toFixed(2)}x time</span></div>
      <div class="stat-row unlocks"><span>Unlocked</span><span>${unlockedMaterials()
        .map((m) => MATERIALS[m].name)
        .join(', ')}</span></div>
    `;
  }

  function renderInventory() {
    el('inventory-body').innerHTML = MATERIAL_IDS.map((id) => {
      const mat = MATERIALS[id];
      return `<div class="stat-row">
        <span><span class="mat-icon" style="color:${mat.color}">${mat.icon}</span> ${mat.name}</span>
        <span>${GameState.player.inventory[id]}</span>
      </div>`;
    }).join('');
  }

  // ---------- right panel: mission selection ----------

  function renderMissionSelect() {
    const rows = MATERIAL_IDS.map((id) => {
      const cfg = MISSIONS[id];
      const mat = MATERIALS[id];
      const unlocked =
        GameState.player.ship.drillLevel >= cfg.requiredDrillLevel;
      const check = canStartMission(id);
      const expectedYield = Math.min(cfg.baseYield, cargoCapacity());
      const duration = formatDuration(missionTotalSeconds(id));
      const destNames = systemsForMaterial(id)
        .map((s) => STAR_SYSTEMS[s].name)
        .join(' / ');

      let btn;
      if (!unlocked) {
        btn = `<button class="hud-btn locked" disabled>🔒 LOCKED</button>`;
      } else if (!check.ok) {
        btn = `<button class="hud-btn" disabled title="${check.reason}">${check.reason.toUpperCase()}</button>`;
      } else {
        btn = `<button class="hud-btn primary" data-start-mission="${id}">LAUNCH</button>`;
      }

      return `<div class="mission-card ${unlocked ? '' : 'locked'}">
        <div class="mission-head">
          <span class="mat-icon" style="color:${mat.color}">${mat.icon}</span>
          <strong>${cfg.name}</strong>
        </div>
        <div class="mission-meta">
          <span>Drill Lv ${cfg.requiredDrillLevel}+ · ${duration}</span>
          <span>Fuel: ${cfg.fuelCost} cr · Yield: ${expectedYield} units</span>
          <span>Destination: ${destNames}</span>
        </div>
        ${btn}
      </div>`;
    }).join('');

    return `<h2 class="widget-title">MINING MISSIONS</h2>${rows}
      <h2 class="widget-title">COURIER CONTRACTS</h2>${renderCourierOffers()}`;
  }

  function renderCourierOffers() {
    return GameState.courierOffers
      .map((offer) => {
        const mat = MATERIALS[offer.rewardMaterialId];
        const unlocked = GameState.player.ship.cargoLevel >= offer.tier;
        const check = canStartCourier(offer);
        const duration = formatDuration(
          offer.durationSeconds * reactorMultiplier(),
        );

        let btn;
        if (!unlocked) {
          btn = `<button class="hud-btn locked" disabled>🔒 REQUIRES CARGO LV ${offer.tier}</button>`;
        } else if (!check.ok) {
          btn = `<button class="hud-btn" disabled title="${check.reason}">${check.reason.toUpperCase()}</button>`;
        } else {
          btn = `<button class="hud-btn primary" data-accept-courier="${offer.id}">ACCEPT</button>`;
        }

        return `<div class="mission-card ${unlocked ? '' : 'locked'}">
        <div class="mission-head">
          <span class="mat-icon accent-cyan">✉</span>
          <strong>Deliver ${offer.cargo}</strong>
        </div>
        <div class="mission-meta">
          <span>→ ${offer.destination} · ${duration}</span>
          <span>Fuel: ${offer.fuelCost} cr · Pay: ${offer.rewardCredits} cr +
            <span class="mat-icon" style="color:${mat.color}">${mat.icon}</span> ${offer.rewardMaterialQty}</span>
        </div>
        ${btn}
      </div>`;
      })
      .join('');
  }

  // ---------- right panel: active mission ----------

  function renderActiveCourier(now) {
    const mission = GameState.currentMission;
    const mat = MATERIALS[mission.rewardMaterialId];
    const total = mission.returnEndsAt - mission.startedAt;
    const pct = Math.round(
      clamp((now - mission.startedAt) / total, 0, 1) * 100,
    );
    const eta = new Date(mission.returnEndsAt);
    const etaStr =
      String(eta.getHours()).padStart(2, '0') +
      ':' +
      String(eta.getMinutes()).padStart(2, '0');

    return `<h2 class="widget-title">COURIER RUN ACTIVE</h2>
      <div class="mission-card active">
        <div class="mission-head">
          <span class="mat-icon accent-cyan">✉</span>
          <strong>Deliver ${mission.cargo}</strong>
        </div>
        <div class="stat-row"><span>Destination</span><span class="accent-cyan">${mission.destination}</span></div>
        <div class="stat-row"><span>Phase</span><span id="am-phase" class="accent-cyan">Travelling</span></div>
        <div class="stat-row"><span>Time remaining</span><span id="am-timer" class="accent-orange">${formatTime(missionTimeRemaining(mission, now))}</span></div>
        <div class="progress-bar"><div id="am-bar" class="progress-fill" style="width:${pct}%; background:#7fe4ff"></div></div>
        <div class="stat-row"><span>Payment</span><span class="accent-green">${mission.rewardCredits} cr +
          <span class="mat-icon" style="color:${mat.color}">${mat.icon}</span> ${mission.rewardMaterialQty} ${mat.name}</span></div>
        <div class="stat-row"><span>Fuel spent</span><span>${mission.fuelCost} cr</span></div>
        <div class="stat-row"><span>Return ETA</span><span>${etaStr}</span></div>
        <p class="hint">Ship is committed. Contract cannot be cancelled.</p>
      </div>`;
  }

  function renderActiveMission(now) {
    const mission = GameState.currentMission;
    if (mission.type === 'courier') return renderActiveCourier(now);
    const cfg = MISSIONS[mission.materialId];
    const mat = MATERIALS[mission.materialId];
    const phase = missionPhase(mission, now);
    const phaseLabels = {
      departing: 'Outbound',
      mining: 'Mining',
      returning: 'Returning',
      complete: 'Docking',
    };
    const cargo = missionCargoProgress(mission, now);
    const pct = Math.round((cargo / mission.expectedYield) * 100);
    const eta = new Date(mission.returnEndsAt);
    const etaStr =
      String(eta.getHours()).padStart(2, '0') +
      ':' +
      String(eta.getMinutes()).padStart(2, '0');

    return `<h2 class="widget-title">MISSION ACTIVE</h2>
      <div class="mission-card active">
        <div class="mission-head">
          <span class="mat-icon" style="color:${mat.color}">${mat.icon}</span>
          <strong>${cfg.name}</strong>
        </div>
        <div class="stat-row"><span>Destination</span><span class="accent-cyan">${STAR_SYSTEMS[missionTargetSystemId(mission)].name} System</span></div>
        <div class="stat-row"><span>Phase</span><span id="am-phase" class="accent-cyan">${phaseLabels[phase]}</span></div>
        <div class="stat-row"><span>Time remaining</span><span id="am-timer" class="accent-orange">${formatTime(missionTimeRemaining(mission, now))}</span></div>
        <div class="stat-row"><span>Cargo</span><span id="am-cargo">${cargo} / ${mission.expectedYield} units</span></div>
        <div class="progress-bar"><div id="am-bar" class="progress-fill" style="width:${pct}%; background:${mat.color}"></div></div>
        <div class="stat-row"><span>Fuel spent</span><span>${mission.fuelCost} cr</span></div>
        <div class="stat-row"><span>Return ETA</span><span>${etaStr}</span></div>
        <p class="hint">Ship is committed. Mission cannot be cancelled.</p>
      </div>`;
  }

  // Live-update the active mission widget without re-rendering inputs
  function updateActiveMission(now) {
    const mission = GameState.currentMission;
    if (!mission) return;
    const phaseEl = el('am-phase');
    if (!phaseEl) return;
    if (mission.type === 'courier') {
      const total = mission.returnEndsAt - mission.startedAt;
      const pct = Math.round(
        clamp((now - mission.startedAt) / total, 0, 1) * 100,
      );
      phaseEl.textContent =
        missionPhase(mission, now) === 'complete' ? 'Docking' : 'Travelling';
      el('am-timer').textContent = formatTime(
        missionTimeRemaining(mission, now),
      );
      el('am-bar').style.width = pct + '%';
      return;
    }
    const phaseLabels = {
      departing: 'Outbound',
      mining: 'Mining',
      returning: 'Returning',
      complete: 'Docking',
    };
    const phase = missionPhase(mission, now);
    const cargo = missionCargoProgress(mission, now);
    phaseEl.textContent = phaseLabels[phase];
    el('am-timer').textContent = formatTime(missionTimeRemaining(mission, now));
    el('am-cargo').textContent =
      cargo + ' / ' + mission.expectedYield + ' units';
    el('am-bar').style.width =
      Math.round((cargo / mission.expectedYield) * 100) + '%';
  }

  // ---------- right panel: market ----------

  function renderMarket() {
    const locked = !!GameState.currentMission;
    const dis = locked ? 'disabled' : '';
    const rows = MATERIAL_IDS.map((id) => {
      const mat = MATERIALS[id];
      const m = GameState.market[id];
      return `<div class="market-card ${locked ? 'locked' : ''}">
        <div class="mission-head">
          <span class="mat-icon" style="color:${mat.color}">${mat.icon}</span>
          <strong>${mat.name}</strong>
          <span class="owned">Owned: ${GameState.player.inventory[id]}</span>
        </div>
        <div class="mission-meta">
          <span>Market buys: <b class="accent-green">${m.buyPrice.toFixed(1)} cr</b></span>
          <span>Market sells: <b class="accent-orange">${m.sellPrice.toFixed(1)} cr</b></span>
        </div>
        <div class="trade-row">
          <input type="number" min="1" value="10" id="qty-${id}" class="hud-input" ${dis}>
          <button class="hud-btn small" data-sell="${id}" ${dis}>SELL</button>
          <button class="hud-btn small" data-buy="${id}" ${dis}>BUY</button>
        </div>
      </div>`;
    }).join('');
    const notice = locked
      ? `<p class="hint">⚠ Ship is away on a mission — trading is only available while docked at Asterion Station.</p>`
      : '';
    return `<h2 class="widget-title">NPC MARKET</h2>${notice}${rows}`;
  }

  // ---------- right panel: upgrades ----------

  function renderUpgradePart(part) {
    const def = UPGRADES[part];
    const lvl = partLevel(part);

    let body;
    if (lvl >= 3) {
      body = `<div class="stat-row"><span>Level</span><span class="accent-green">3 — MAX</span></div>
        <div class="stat-row"><span>${def.bonusLabel(lvl)}</span></div>
        <p class="hint">This system is fully upgraded.</p>`;
    } else {
      const cost = def.levels[lvl + 1];
      const check = canUpgrade(part);
      const matRows = Object.entries(cost.materials)
        .map(([mat, qty]) => {
          const have = GameState.player.inventory[mat];
          const ok = have >= qty;
          return `<div class="stat-row"><span>${MATERIALS[mat].name}</span>
          <span class="${ok ? 'accent-green' : 'accent-red'}">${have} / ${qty}</span></div>`;
        })
        .join('');
      const credOk = GameState.player.credits >= cost.credits;

      body = `
        <div class="stat-row"><span>Current Level</span><span class="accent-cyan">${lvl}</span></div>
        <div class="stat-row"><span>${def.bonusLabel(lvl)}</span></div>
        <hr class="hud-hr">
        <div class="stat-row"><span>Next Level</span><span class="accent-orange">${lvl + 1}</span></div>
        <div class="stat-row"><span>${cost.unlocks}</span></div>
        <hr class="hud-hr">
        <div class="stat-row"><span>Credits</span>
          <span class="${credOk ? 'accent-green' : 'accent-red'}">${GameState.player.credits} / ${cost.credits}</span></div>
        ${matRows}
        <button class="hud-btn primary wide" data-upgrade="${part}" ${check.ok ? '' : 'disabled'}
          ${check.ok ? '' : `title="${check.reason}"`}>
          ${check.ok ? 'UPGRADE ' + def.name.toUpperCase() : check.reason.toUpperCase()}
        </button>`;
    }

    return `<h2 class="widget-title">${def.name.toUpperCase()}</h2>
      <div class="upgrade-nav">
        ${Object.keys(UPGRADES)
          .map(
            (p) =>
              `<button class="hud-btn small ${p === part ? 'tab-active' : ''}" data-select-part="${p}">${UPGRADES[p].name.split(' ')[0].toUpperCase()}</button>`,
          )
          .join('')}
      </div>
      ${body}`;
  }

  function renderUpgrades() {
    const part = GameState.selectedShipPart || 'drill';
    return renderUpgradePart(part);
  }

  // ---------- right panel dispatcher ----------

  function renderRightPanel(now) {
    let html;
    if (GameState.selectedPanel === 'mine') {
      html = GameState.currentMission
        ? renderActiveMission(now)
        : renderMissionSelect();
    } else if (GameState.selectedPanel === 'market') {
      html = renderMarket();
    } else {
      html = renderUpgrades();
    }
    el('right-widget-body').innerHTML = html;

    document.querySelectorAll('#panel-tabs .tab').forEach((b) => {
      b.classList.toggle(
        'tab-active',
        b.dataset.tab === GameState.selectedPanel,
      );
    });
  }

  // ---------- log + toast ----------

  function renderLog() {
    el('log-lines').innerHTML = GameState.eventLog
      .map((l) => `<div class="log-line">${l}</div>`)
      .join('');
    el('log-lines').scrollTop = el('log-lines').scrollHeight;
  }

  function showToast(html) {
    const t = document.createElement('div');
    t.className = 'toast hud-panel';
    t.innerHTML = html;
    el('toast-container').appendChild(t);
    setTimeout(() => t.classList.add('visible'), 30);
    setTimeout(() => {
      t.classList.remove('visible');
      setTimeout(() => t.remove(), 600);
    }, 5000);
  }

  function flashError(reason) {
    showToast(
      `<div class="toast-title accent-red">ACTION BLOCKED</div><div>${reason}</div>`,
    );
  }

  // ---------- full render ----------

  function renderAll() {
    const now = Date.now();
    renderTopBar(now);
    renderShipStatus();
    renderInventory();
    renderRightPanel(now);
    renderLog();
  }

  // ---------- event wiring ----------

  function bindEvents() {
    // mobile bottom-sheet nav
    document.querySelectorAll('#mobile-nav .mnav-btn').forEach((b) => {
      b.addEventListener('click', () => toggleSheet(b.dataset.sheet));
    });
    el('mobile-backdrop').addEventListener('click', () => openSheet(''));

    // tabs
    document.querySelectorAll('#panel-tabs .tab').forEach((b) => {
      b.addEventListener('click', () => {
        GameState.selectedPanel = b.dataset.tab;
        saveState();
        renderAll();
      });
    });

    // delegated clicks inside the right widget
    el('right-widget-body').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.startMission) {
        const res = startMission(btn.dataset.startMission);
        if (!res.ok) return flashError(res.reason);
        Scene.focusShip();
        openSheet(''); // reveal the departing ship on mobile
        renderAll();
      } else if (btn.dataset.acceptCourier) {
        const res = startCourierMission(btn.dataset.acceptCourier);
        if (!res.ok) return flashError(res.reason);
        Scene.focusShip();
        openSheet('');
        renderAll();
      } else if (btn.dataset.sell || btn.dataset.buy) {
        const id = btn.dataset.sell || btn.dataset.buy;
        const qty = parseInt(el('qty-' + id).value, 10) || 0;
        const res = btn.dataset.sell
          ? sellMaterial(id, qty)
          : buyMaterial(id, qty);
        if (!res.ok) return flashError(res.reason);
        renderAll();
      } else if (btn.dataset.upgrade) {
        const res = upgradePart(btn.dataset.upgrade);
        if (!res.ok) return flashError(res.reason);
        renderAll();
      } else if (btn.dataset.selectPart) {
        GameState.selectedShipPart = btn.dataset.selectPart;
        saveState();
        renderAll();
      }
    });

    // clickable ship parts (only while docked)
    const partMap = {
      'part-drill': 'drill',
      'part-cargo': 'cargo',
      'part-reactor': 'reactor',
    };
    const tooltip = el('ship-tooltip');
    for (const [svgId, part] of Object.entries(partMap)) {
      const g = el(svgId);
      g.addEventListener('click', () => {
        if (GameState.currentMission) return;
        GameState.selectedPanel = 'upgrade';
        GameState.selectedShipPart = part;
        saveState();
        openSheet('ops'); // surface the upgrade panel on mobile
        renderAll();
      });
      g.addEventListener('mouseenter', () => {
        if (GameState.currentMission) return;
        tooltip.textContent = UPGRADES[part].name + ' — Lv ' + partLevel(part);
        tooltip.style.opacity = 1;
      });
      g.addEventListener('mouseleave', () => {
        tooltip.style.opacity = 0;
      });
    }

    // debug
    el('btn-skip').addEventListener('click', () => {
      const m = GameState.currentMission;
      if (!m) return flashError('No active mission to skip');
      const skip = 60000;
      m.outboundEndsAt -= skip;
      m.miningEndsAt -= skip;
      m.returnEndsAt -= skip;
      saveState();
      renderAll();
    });
    el('btn-add-credits').addEventListener('click', () => {
      GameState.player.credits += 100;
      saveState();
      renderAll();
    });
    el('btn-reset').addEventListener('click', () => {
      if (!confirm('Reset all progress?')) return;
      resetGame();
      Scene.focusShip();
      renderAll();
    });
  }

  return {
    renderAll,
    updateActiveMission,
    renderTopBar,
    showToast,
    bindEvents,
  };
})();
