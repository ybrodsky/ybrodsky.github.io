// =====================================================
// SCENE RENDERER — star-cluster map drawn through a
// world-coordinate camera. The camera follows the ship
// (auto mode) and cinematically zooms out/in around
// missions; the player can drag to pan and wheel/pinch
// to zoom (manual mode) and recenter at any time. Ship
// position is derived from mission timestamps, so it
// always travels at the speed that matches the ETA.
// =====================================================

const Scene = (() => {
  const canvas = document.getElementById("space-canvas");
  const ctx = canvas.getContext("2d");
  const sceneEl = document.getElementById("scene-container");
  const shipWrap = document.getElementById("ship-wrap");
  const recenterBtn = document.getElementById("btn-recenter");

  const ISO_SQUASH = MAP_ISO_SQUASH; // isometric tilt: orbits are squashed vertically
  const ZOOM_MAX = 3.0;
  const STATION_WORLD = 132;     // station image diameter in design px (multiplied by stScale)
  const STATION_SPIN = 0.00008;  // radians/ms — slow clockwise rotation

  const stationImg = new Image();
  stationImg.src = "assets/station.png";
  const CAM_RATE = 0.0015;     // exponential approach rate per ms (auto camera)
  const HEADING_RATE = 0.004;  // ship rotation smoothing
  const DOCKED_VIEW_RADIUS = 430; // world units visible around the docked ship
  const SHIP_SCALE = 0.6;      // ship DOM scale relative to zoom

  let width = 0, height = 0;
  let zoomMin = 0.08;          // computed so max zoom-out fits the whole cluster
  let clusterRadius = 1000;

  let stars = [];
  let systemRocks = {};        // systemId -> generated belt rocks
  let particles = [];
  let trail = [];              // world-space engine trail points
  let lastTrailAt = 0;
  let beamTarget = null;       // world pos of the belt rock being mined

  const camera = { x: 0, y: 0, zoom: 0.8 };
  let camMode = "auto";        // "auto" follows the ship; "manual" after pan/zoom
  let camSnapped = false;      // first frame snaps instead of easing in
  let heading = 0;
  let lastT = 0;

  // ---------- helpers ----------

  function rand(min, max) { return min + Math.random() * (max - min); }
  function mod(v, m) { return ((v % m) + m) % m; }
  function lerpP(a, b, f) { return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }

  function w2s(p) {
    return {
      x: (p.x - camera.x) * camera.zoom + width / 2,
      y: (p.y - camera.y) * camera.zoom + height / 2,
    };
  }

  // ---------- world geometry ----------

  function systemExtent(sys) {
    let r = sys.star.r * 3;
    for (const b of sys.bodies || []) r = Math.max(r, b.dist * 1.15);
    if (sys.belt) r = Math.max(r, sys.belt.dist * 1.25);
    return r;
  }

  function computeClusterRadius() {
    clusterRadius = 0;
    for (const sys of Object.values(STAR_SYSTEMS)) {
      clusterRadius = Math.max(clusterRadius, Math.hypot(sys.pos.x, sys.pos.y) + systemExtent(sys));
    }
  }

  // Orbit angles use wall-clock time so positions survive reloads.
  function bodyOrbitPos(sys, b, t) {
    const a = b.phase + t * b.speed;
    const depth = Math.sin(a);
    return { x: sys.pos.x + Math.cos(a) * b.dist, y: sys.pos.y + depth * b.dist * ISO_SQUASH, depth };
  }

  function stationWorldPos(t) {
    const sys = STAR_SYSTEMS[HOME_SYSTEM_ID];
    const home = sys.bodies.find((b) => b.home);
    const p = bodyOrbitPos(sys, home, t);
    return { x: p.x + home.r * 2.6, y: p.y - home.r * 1.6 };
  }

  function dockWorldPos(t) {
    const st = stationWorldPos(t);
    return { x: st.x + 70, y: st.y + 8 };
  }

  // Where the ship parks to mine: just inside the system's belt.
  function miningSpotWorld(systemId) {
    const sys = STAR_SYSTEMS[systemId];
    const d = sys.belt ? sys.belt.dist : systemExtent(sys) * 0.6;
    return {
      x: sys.pos.x + Math.cos(0.6) * d,
      y: sys.pos.y + Math.sin(0.6) * d * ISO_SQUASH + 26,
    };
  }

  // Ship position/mode derived purely from mission timestamps.
  function shipWorldState(now) {
    const dock = dockWorldPos(now);
    const mission = GameState ? GameState.currentMission : null;
    if (!mission) return { pos: dock, mode: "docked", target: null };
    const phase = missionPhase(mission, now);
    if (phase === "complete") return { pos: dock, mode: "docked", target: null };

    if (mission.type === "courier") {
      const dest = courierDestPos(mission, now);
      const frac = clamp((now - mission.startedAt) / (mission.returnEndsAt - mission.startedAt), 0, 1);
      return frac < 0.5
        ? { pos: lerpP(dock, dest, frac * 2), mode: "flying", target: dest }
        : { pos: lerpP(dest, dock, (frac - 0.5) * 2), mode: "flying", target: dock };
    }

    const spot = miningSpotWorld(missionTargetSystemId(mission));
    if (phase === "departing") {
      const frac = clamp((now - mission.startedAt) / (mission.outboundEndsAt - mission.startedAt), 0, 1);
      return { pos: lerpP(dock, spot, frac), mode: "flying", target: spot };
    }
    if (phase === "mining") return { pos: spot, mode: "mining", target: null };
    const frac = clamp((now - mission.miningEndsAt) / (mission.returnEndsAt - mission.miningEndsAt), 0, 1);
    return { pos: lerpP(spot, dock, frac), mode: "flying", target: dock };
  }

  // ---------- camera ----------

  function fitZoom(r) {
    return clamp(Math.min(width, height) * 0.5 / r, zoomMin, ZOOM_MAX);
  }

  function cameraAutoTarget(ship) {
    if (ship.mode === "mining") {
      const sys = STAR_SYSTEMS[missionTargetSystemId(GameState.currentMission)];
      return { x: sys.pos.x, y: sys.pos.y, zoom: fitZoom(systemExtent(sys) * 1.18) };
    }
    if (ship.mode === "flying" && ship.target) {
      // keep the ship and its destination both in frame
      const r = Math.hypot(ship.target.x - ship.pos.x, ship.target.y - ship.pos.y) / 2 + 340;
      return {
        x: (ship.pos.x + ship.target.x) / 2,
        y: (ship.pos.y + ship.target.y) / 2,
        zoom: fitZoom(r),
      };
    }
    return { x: ship.pos.x, y: ship.pos.y, zoom: fitZoom(DOCKED_VIEW_RADIUS) };
  }

  function updateCamera(ship, dt) {
    if (camMode !== "auto") return;
    const tgt = cameraAutoTarget(ship);
    if (!camSnapped) {
      camera.x = tgt.x; camera.y = tgt.y; camera.zoom = tgt.zoom;
      camSnapped = true;
      return;
    }
    const k = 1 - Math.exp(-dt * CAM_RATE);
    camera.x += (tgt.x - camera.x) * k;
    camera.y += (tgt.y - camera.y) * k;
    // ease zoom in log space so zoom-out and zoom-in feel symmetric
    camera.zoom = Math.exp(Math.log(camera.zoom) + (Math.log(tgt.zoom) - Math.log(camera.zoom)) * k);
  }

  // ---------- setup ----------

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = canvas.width = rect.width;
    height = canvas.height = rect.height;
    zoomMin = Math.min(width, height) * 0.46 / clusterRadius;
    buildStars();
  }

  function buildStars() {
    stars = [];
    const count = Math.floor((width * height) / 4000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: rand(0.3, 1.6),
        tw: Math.random() * Math.PI * 2,
        twSpeed: rand(0.6, 3.6),
        par: rand(0.04, 0.22), // parallax factor
      });
    }
  }

  function buildAsteroidShape(r) {
    const points = [];
    const n = 6 + Math.floor(Math.random() * 5);
    for (let p = 0; p < n; p++) {
      const a = (p / n) * Math.PI * 2;
      const rr = r * rand(0.7, 1.2);
      points.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    return points;
  }

  function buildBeltRocks() {
    systemRocks = {};
    for (const [id, sys] of Object.entries(STAR_SYSTEMS)) {
      if (!sys.belt) continue;
      const rocks = [];
      for (let i = 0; i < sys.belt.count; i++) {
        const r = rand(3, 7);
        rocks.push({
          phase: rand(0, Math.PI * 2),
          speed: rand(0.000014, 0.000026),
          jit: rand(0.9, 1.1),
          r,
          points: buildAsteroidShape(r),
          color: sys.belt.colors[i % sys.belt.colors.length],
        });
      }
      systemRocks[id] = rocks;
    }
  }

  // ---------- drawing ----------

  function drawStars(t) {
    for (const s of stars) {
      const px = mod(s.x - camera.x * camera.zoom * s.par, width);
      const py = mod(s.y - camera.y * camera.zoom * s.par, height);
      const tw = 0.55 + 0.45 * Math.sin(t * 0.001 * s.twSpeed + s.tw);
      ctx.fillStyle = "rgba(220, 235, 255, " + (tw * 0.9) + ")";
      ctx.beginPath();
      ctx.arc(px, py, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGalaxy(x, y, rx, ry, color, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.scale(1, ry / rx);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlanet(x, y, r, c1, c2) {
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLabel(text, x, y, alpha, color) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 0.5 : alpha;
    ctx.fillStyle = color || "rgb(120, 200, 220)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawSun(sys, t) {
    const c = w2s(sys.pos);
    const pulse = 1 + Math.sin(t * 0.0012 + sys.pos.x) * 0.05;
    const coreR = Math.max(sys.star.r * camera.zoom, 2.5) * pulse;
    const pal = sys.star;
    let g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, coreR * 4.5);
    g.addColorStop(0, "rgba(" + pal.halo + ", 0.50)");
    g.addColorStop(0.35, "rgba(" + pal.halo + ", 0.16)");
    g.addColorStop(1, "rgba(" + pal.halo + ", 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, coreR * 4.5, 0, Math.PI * 2);
    ctx.fill();
    g = ctx.createRadialGradient(c.x - coreR * 0.2, c.y - coreR * 0.2, coreR * 0.1, c.x, c.y, coreR);
    g.addColorStop(0, pal.core0);
    g.addColorStop(0.55, pal.core1);
    g.addColorStop(1, pal.core2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, coreR, 0, Math.PI * 2);
    ctx.fill();
    return coreR;
  }

  function drawStation(t, x, y, scale) {
    if (!stationImg.complete || !stationImg.naturalWidth) return;
    const size = STATION_WORLD * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * STATION_SPIN); // canvas y-down: positive angle = clockwise
    ctx.drawImage(stationImg, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawSystem(sysId, sys, t) {
    const c = w2s(sys.pos);
    const z = camera.zoom;
    const extPx = systemExtent(sys) * z;
    if (c.x < -extPx - 80 || c.x > width + extPx + 80 ||
        c.y < -extPx - 80 || c.y > height + extPx + 80) return;

    // orbit paths
    ctx.save();
    ctx.strokeStyle = "rgba(160, 200, 230, 0.10)";
    ctx.lineWidth = 1;
    for (const b of sys.bodies || []) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, b.dist * z, b.dist * z * ISO_SQUASH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // asteroid belt: faint guide band + orbiting rocks
    let placedRocks = [];
    if (sys.belt) {
      ctx.save();
      ctx.strokeStyle = "rgba(160, 200, 230, 0.05)";
      ctx.lineWidth = Math.max(12 * z, 1.5);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, sys.belt.dist * z, sys.belt.dist * z * ISO_SQUASH, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      placedRocks = systemRocks[sysId].map((rock) => {
        const a = rock.phase + t * rock.speed;
        const depth = Math.sin(a);
        return {
          rock,
          x: c.x + Math.cos(a) * sys.belt.dist * rock.jit * z,
          y: c.y + depth * sys.belt.dist * rock.jit * ISO_SQUASH * z,
          s: (1 + depth * 0.35) * z,
          depth,
        };
      });
    }

    const placedBodies = (sys.bodies || []).map((b) => {
      const a = b.phase + t * b.speed;
      const depth = Math.sin(a);
      return {
        b,
        x: c.x + Math.cos(a) * b.dist * z,
        y: c.y + depth * b.dist * ISO_SQUASH * z,
        s: (1 + depth * 0.25) * z,
        depth,
      };
    });

    function drawRock(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.s, p.s);
      ctx.fillStyle = p.rock.color;
      ctx.beginPath();
      p.rock.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawBody(p) {
      const r = Math.max(p.b.r * p.s, 1.2);
      if (p.b.ring) {
        ctx.strokeStyle = "rgba(200, 180, 255, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 1.9, r * 0.55, -0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p.b.home) {
        ctx.save();
        ctx.shadowColor = "#5aa8e8";
        ctx.shadowBlur = 18;
        drawPlanet(p.x, p.y, r, p.b.c1, p.b.c2);
        ctx.restore();
        const st = w2s(stationWorldPos(t));
        const stScale = z * 0.62;
        drawStation(t, st.x, st.y, stScale);
        if (z > 0.45) drawLabel(HOME_STATION_NAME, st.x, st.y + (STATION_WORLD / 2) * stScale + 12, 0.6);
      } else {
        drawPlanet(p.x, p.y, r, p.b.c1, p.b.c2);
      }
      if (z > 0.5) drawLabel(p.b.name, p.x, p.y + r + 13);
    }

    placedRocks.filter((p) => p.depth < 0).forEach(drawRock);
    placedBodies.filter((p) => p.depth < 0).sort((a, b) => a.y - b.y).forEach(drawBody);
    const sunPx = drawSun(sys, t);
    placedBodies.filter((p) => p.depth >= 0).sort((a, b) => a.y - b.y).forEach(drawBody);
    placedRocks.filter((p) => p.depth >= 0).forEach(drawRock);

    drawLabel(sys.name, c.x, c.y + sunPx + 14, 0.55);
    if (sys.resource) {
      drawLabel(MATERIALS[sys.resource].name.toUpperCase() + " BELT",
        c.x, c.y + sunPx + 25, 0.7, MATERIALS[sys.resource].color);
    }
  }

  // nearest belt rock to the ship — the mining beam's target
  function findBeamTarget(now, shipPos) {
    const mission = GameState.currentMission;
    if (!mission || mission.type === "courier") return null;
    const sysId = missionTargetSystemId(mission);
    const sys = STAR_SYSTEMS[sysId];
    if (!sys.belt || !systemRocks[sysId]) return null;
    let best = null, bestD = Infinity;
    for (const rock of systemRocks[sysId]) {
      const a = rock.phase + now * rock.speed;
      const x = sys.pos.x + Math.cos(a) * sys.belt.dist * rock.jit;
      const y = sys.pos.y + Math.sin(a) * sys.belt.dist * rock.jit * ISO_SQUASH;
      const d = Math.hypot(x - shipPos.x, y - shipPos.y);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    return best;
  }

  function shipNose() {
    const r = shipWrap.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    return { x: r.right - c.left - 8, y: r.top - c.top + r.height / 2 };
  }

  function drawMiningBeam(t) {
    if (!beamTarget) { particles = []; return; }
    const tip = shipNose();
    const tp = w2s(beamTarget);

    const flicker = 0.5 + 0.5 * Math.sin(t * 0.02);
    ctx.save();
    ctx.strokeStyle = "rgba(64, 255, 200, " + (0.35 + flicker * 0.4) + ")";
    ctx.lineWidth = 2 + flicker * 2;
    ctx.shadowColor = "#40ffc8";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    ctx.restore();

    // particles drifting from the rock to the ship
    if (Math.random() < 0.3) {
      particles.push({ t: 0, w: { x: beamTarget.x, y: beamTarget.y } });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += 0.02;
      if (p.t >= 1) { particles.splice(i, 1); continue; }
      const sp = w2s(p.w);
      const px = sp.x + (tip.x - sp.x) * p.t;
      const py = sp.y + (tip.y - sp.y) * p.t + Math.sin(p.t * 10) * 4;
      ctx.fillStyle = "rgba(120, 255, 220, " + (1 - p.t) + ")";
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Dashed route from ship to destination while in transit.
  function drawTravelRoute(ship, t) {
    if (ship.mode !== "flying" || !ship.target) return;
    const from = w2s(ship.pos);
    const to = w2s(ship.target);
    const z = clamp(camera.zoom, 0.35, 1.8);
    const dash = 10 * z;
    const gap = 7 * z;

    ctx.save();
    ctx.strokeStyle = "rgba(120, 200, 220, 0.42)";
    ctx.lineWidth = Math.max(1.2, 1.8 * z);
    ctx.lineCap = "round";
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -(t * 0.035) % (dash + gap);
    ctx.shadowColor = "rgba(120, 200, 220, 0.55)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // destination ping
    ctx.setLineDash([]);
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(120, 200, 220, 0.55)";
    ctx.beginPath();
    ctx.arc(to.x, to.y, Math.max(2.5, 3.5 * z), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(180, 235, 255, 0.75)";
    ctx.lineWidth = Math.max(1, 1.2 * z);
    ctx.stroke();
    ctx.restore();
  }

  // Engine trail left behind while the ship burns
  function drawTrail(t) {
    while (trail.length && t - trail[0].born > 900) trail.shift();
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    const lw = clamp(camera.zoom, 0.4, 1.5);
    for (let i = 1; i < trail.length; i++) {
      const age = (t - trail[i].born) / 900;
      const a = w2s(trail[i - 1]);
      const b = w2s(trail[i]);
      ctx.strokeStyle = "rgba(127, 228, 255, " + ((1 - age) * 0.55) + ")";
      ctx.lineWidth = ((1 - age) * 5 + 0.5) * lw;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFrame(now, ship) {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, "#040816");
    g.addColorStop(1, "#0a1228");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    drawGalaxy(width * 0.22, height * 0.24, 150, 55, "rgba(110, 80, 200, 0.10)", 0.5);
    drawGalaxy(width * 0.82, height * 0.72, 120, 45, "rgba(60, 160, 200, 0.09)", -0.3);
    drawStars(now);

    for (const [id, sys] of Object.entries(STAR_SYSTEMS)) drawSystem(id, sys, now);

    drawTrail(now);
    drawTravelRoute(ship, now);
    drawMiningBeam(now);
  }

  // ---------- ship DOM ----------

  function syncShipClasses(mode) {
    shipWrap.classList.toggle("docked", mode === "docked");
    shipWrap.classList.toggle("flying", mode === "flying");
    shipWrap.classList.toggle("mining", mode === "mining");
  }

  function positionShip(ship, dt) {
    const s = w2s(ship.pos);
    const scale = clamp(camera.zoom * SHIP_SCALE, 0.14, 0.95);

    let desired = heading;
    if (ship.mode === "flying" && ship.target) {
      desired = Math.atan2(ship.target.y - ship.pos.y, ship.target.x - ship.pos.x);
    } else if (ship.mode === "mining" && beamTarget) {
      desired = Math.atan2(beamTarget.y - ship.pos.y, beamTarget.x - ship.pos.x);
    } else if (ship.mode === "docked") {
      desired = 0;
    }
    let d = desired - heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    heading += d * (1 - Math.exp(-dt * HEADING_RATE));

    // mirror vertically when facing left so the ship is never upside-down
    const flip = Math.cos(heading) < 0;
    shipWrap.style.left = (s.x - 75) + "px";
    shipWrap.style.top = (s.y - 25.5) + "px";
    shipWrap.style.rotate = heading + "rad";
    shipWrap.style.scale = flip ? scale + " " + (-scale) : String(scale);
  }

  // ---------- frame loop ----------

  function frame() {
    const now = Date.now();
    const dt = lastT ? Math.min(now - lastT, 100) : 16;
    lastT = now;

    if (width > 0) {
      const ship = shipWorldState(now);
      updateCamera(ship, dt);
      beamTarget = ship.mode === "mining" ? findBeamTarget(now, ship.pos) : null;
      drawFrame(now, ship);
      syncShipClasses(ship.mode);
      positionShip(ship, dt);
      if (ship.mode === "flying" && now - lastTrailAt > 40) {
        trail.push({ x: ship.pos.x, y: ship.pos.y, born: now });
        lastTrailAt = now;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- map interaction ----------

  function setManual() {
    camMode = "manual";
    recenterBtn.classList.add("visible");
  }

  function focusShip() {
    camMode = "auto";
    recenterBtn.classList.remove("visible");
  }

  function zoomAt(px, py, factor) {
    setManual();
    const wx = camera.x + (px - width / 2) / camera.zoom;
    const wy = camera.y + (py - height / 2) / camera.zoom;
    camera.zoom = clamp(camera.zoom * factor, zoomMin, ZOOM_MAX);
    camera.x = wx - (px - width / 2) / camera.zoom;
    camera.y = wy - (py - height / 2) / camera.zoom;
  }

  let dragging = false, lastPt = null, pinchDist = 0;

  sceneEl.addEventListener("mousedown", (e) => {
    if (e.target.closest("#ship-wrap") || e.target.closest("#map-controls")) return;
    dragging = true;
    lastPt = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    setManual();
    camera.x -= (e.clientX - lastPt.x) / camera.zoom;
    camera.y -= (e.clientY - lastPt.y) / camera.zoom;
    lastPt = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener("mouseup", () => { dragging = false; });

  sceneEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0012));
  }, { passive: false });

  // touch: one finger pans, two fingers pinch-zoom
  sceneEl.addEventListener("touchstart", (e) => {
    if (e.target.closest("#map-controls")) return;
    if (e.touches.length === 1) {
      lastPt = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  sceneEl.addEventListener("touchmove", (e) => {
    if (e.target.closest("#map-controls")) return;
    e.preventDefault();
    if (e.touches.length === 1 && lastPt) {
      setManual();
      camera.x -= (e.touches[0].clientX - lastPt.x) / camera.zoom;
      camera.y -= (e.touches[0].clientY - lastPt.y) / camera.zoom;
      lastPt = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && pinchDist > 0) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const rect = canvas.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoomAt(midX, midY, d / pinchDist);
      pinchDist = d;
    }
  }, { passive: false });

  sceneEl.addEventListener("touchend", () => { lastPt = null; pinchDist = 0; });

  recenterBtn.addEventListener("click", focusShip);

  // ---------- init ----------

  computeClusterRadius();
  buildBeltRocks();
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);

  return { focusShip };
})();
