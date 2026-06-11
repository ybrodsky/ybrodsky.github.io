// =====================================================
// SCENE RENDERER — animated 2D canvas background plus
// DOM ship animation (departure / arrival / mining beam).
// =====================================================

const Scene = (() => {
  const canvas = document.getElementById("space-canvas");
  const ctx = canvas.getContext("2d");
  const fadeEl = document.getElementById("scene-fade");
  const shipWrap = document.getElementById("ship-wrap");

  let width = 0, height = 0;
  let stars = [];
  let asteroids = [];
  let belt = [];
  let activeScene = "station"; // scene currently drawn
  let transitioning = false;
  let beamActive = false;
  let particles = [];
  let trail = [];
  let trailActive = false;
  let dockPos = null; // ship's docking spot beside the station (orbits with it)

  // Mining scenes: foreground rocks near the ship + an asteroid belt
  // orbiting a distant star.
  const MINING_SCENE_CFG = {
    asteroidField: {
      count: 7,
      colors: ["#6b6f76", "#7d7368", "#5c5f66"],
      glow: null,
      star: { core0: "#fff7e0", core1: "#ffd76a", core2: "#ff9330", halo: "255, 180, 80", name: "KORVAX" },
      beltColors: ["#6b6f76", "#56524c", "#4a4d52"],
      planets: [
        { name: "KORVAX I",  dist: 0.26, speed: 0.00005,  phase: 1.7, r: 5, c1: "#d8b287", c2: "#5e4426" },
        { name: "KORVAX II", dist: 0.40, speed: 0.00003,  phase: 4.3, r: 8, c1: "#b07a5a", c2: "#3c241c", ring: true },
      ],
    },
    crystalField: {
      count: 6,
      colors: ["#2b5f8f", "#3a7ab5", "#27496b"],
      glow: "#4db8ff",
      star: { core0: "#f0fbff", core1: "#9fd8ff", core2: "#4a90e0", halo: "120, 190, 255", name: "CRYOS" },
      beltColors: ["#2b5f8f", "#27496b", "#1f3a56"],
      planets: [
        { name: "CRYOS I",  dist: 0.28, speed: 0.000045, phase: 0.8, r: 6, c1: "#bfe8ff", c2: "#1d3f63" },
        { name: "CRYOS II", dist: 0.43, speed: 0.000026, phase: 3.5, r: 9, c1: "#6fb4e8", c2: "#102a44", ring: true },
      ],
    },
    voidField: {
      count: 5,
      colors: ["#3a2454", "#2a1840", "#46306b"],
      glow: "#b86bff",
      star: { core0: "#f4e8ff", core1: "#c89aff", core2: "#7a3ad0", halo: "160, 100, 255", name: "EREBUS" },
      beltColors: ["#3a2454", "#46306b", "#241634"],
      planets: [
        { name: "EREBUS I",  dist: 0.30, speed: 0.00004,  phase: 2.4, r: 7,  c1: "#c9a0ff", c2: "#2a1646" },
        { name: "EREBUS II", dist: 0.46, speed: 0.000022, phase: 5.1, r: 10, c1: "#7a55b0", c2: "#170b2c" },
      ],
    },
  };

  // ---------- setup ----------

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = canvas.width = rect.width;
    height = canvas.height = rect.height;
    buildStars();
    buildSceneObjects();
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  function buildStars() {
    stars = [];
    const count = Math.floor((width * height) / 4000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: rand(0.3, 1.6),
        speed: rand(2, 12),
        tw: Math.random() * Math.PI * 2,
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

  function buildSceneObjects() {
    asteroids = [];
    belt = [];
    const cfg = MINING_SCENE_CFG[activeScene];
    if (!cfg) return;

    // distant asteroid belt orbiting the local star
    const beltCount = 26;
    for (let i = 0; i < beltCount; i++) {
      const r = rand(2, 5.5);
      belt.push({
        phase: rand(0, Math.PI * 2),
        speed: rand(0.000018, 0.00003),
        distJitter: rand(0.88, 1.12),
        r,
        points: buildAsteroidShape(r),
        color: cfg.beltColors[i % cfg.beltColors.length],
      });
    }

    for (let i = 0; i < cfg.count; i++) {
      const points = [];
      const r = rand(9, 26);
      const n = 8 + Math.floor(Math.random() * 4);
      for (let p = 0; p < n; p++) {
        const a = (p / n) * Math.PI * 2;
        const rr = r * rand(0.7, 1.2);
        points.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
      }
      asteroids.push({
        x: rand(width * 0.1, width * 0.9),
        y: rand(height * 0.08, height * 0.5),
        points,
        color: cfg.colors[i % cfg.colors.length],
        glow: cfg.glow,
        drift: rand(-3, 3),
        phase: Math.random() * Math.PI * 2,
        r,
      });
    }
    // sort so the largest is near center — that's the mining target
    asteroids.sort((a, b) => b.r - a.r);
    if (asteroids.length) {
      asteroids[0].x = width * 0.5 + rand(-40, 40);
      asteroids[0].y = height * 0.28;
    }
  }

  // ---------- drawing ----------

  function drawStars(t, warp) {
    for (const s of stars) {
      if (warp) {
        // streaking stars in transit
        const len = s.speed * 6;
        ctx.strokeStyle = "rgba(160, 220, 255, " + (0.2 + s.r * 0.3) + ")";
        ctx.lineWidth = s.r * 0.8;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - len, s.y);
        ctx.stroke();
        s.x -= s.speed * 1.8;
        if (s.x < -len) { s.x = width + len; s.y = Math.random() * height; }
      } else {
        const tw = 0.55 + 0.45 * Math.sin(t * 0.001 * s.speed * 0.3 + s.tw);
        ctx.fillStyle = "rgba(220, 235, 255, " + (tw * 0.9) + ")";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        s.x -= s.speed * 0.012;
        if (s.x < 0) s.x = width;
      }
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

  // ---------- solar system (station scene) ----------

  // dist = orbit radius (fraction of scene), speed = rad/ms
  const SOLAR_BODIES = [
    { name: "CINDER",  dist: 0.16, speed: 0.00010,  phase: 2.1, r: 5,  c1: "#e0b070", c2: "#6a4520" },
    { name: "FERROS",  dist: 0.30, speed: 0.00006,  phase: 4.6, r: 8,  c1: "#c97b54", c2: "#46241a" },
    { name: "VANTH",   dist: 0.45, speed: 0.00003,  phase: 3.8, r: 11, c1: "#8a68b8", c2: "#241440", ring: true },
    // home planet rides the outermost orbit — closest to the camera
    { name: "AURELIA", dist: 0.62, speed: 0.000016, phase: 1.3, r: 16, c1: "#4a86c8", c2: "#0e1c33", home: true },
  ];

  const SUN_NAME = "HELIOS";

  const ISO_SQUASH = 0.36; // isometric tilt: orbit ellipses are squashed verticaly

  const DEFAULT_STAR = { core0: "#fff7e0", core1: "#ffd76a", core2: "#ff9330", halo: "255, 180, 80" };

  function drawSun(x, y, t, palette, sizeFactor) {
    const pal = palette || DEFAULT_STAR;
    const pulse = 1 + Math.sin(t * 0.0012) * 0.05;
    const coreR = Math.min(width, height) * (sizeFactor || 0.045) * pulse;
    // halo
    let g = ctx.createRadialGradient(x, y, 0, x, y, coreR * 5);
    g.addColorStop(0, "rgba(" + pal.halo + ", 0.50)");
    g.addColorStop(0.35, "rgba(" + pal.halo + ", 0.16)");
    g.addColorStop(1, "rgba(" + pal.halo + ", 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, coreR * 5, 0, Math.PI * 2);
    ctx.fill();
    // core
    g = ctx.createRadialGradient(x - coreR * 0.2, y - coreR * 0.2, coreR * 0.1, x, y, coreR);
    g.addColorStop(0, pal.core0);
    g.addColorStop(0.55, pal.core1);
    g.addColorStop(1, pal.core2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, coreR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distant star with planets and the asteroid belt orbiting it
  // (mining scenes). The star sits at the center of the viewport.
  function drawBeltAndStar(t, cfg) {
    const sx = width * 0.5, sy = height * 0.5;
    const scaleR = Math.min(width, height);
    const brx = scaleR * 0.55;
    const bry = brx * ISO_SQUASH;

    // faint belt guide band
    ctx.save();
    ctx.strokeStyle = "rgba(160, 200, 230, 0.06)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(sx, sy, brx, bry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const placed = belt.map((rock) => {
      const a = rock.phase + t * rock.speed;
      const depth = Math.sin(a);
      return {
        rock,
        x: sx + Math.cos(a) * brx * rock.distJitter,
        y: sy + depth * bry * rock.distJitter,
        s: 1 + depth * 0.45,
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

    // planets of the local system, inside the belt
    const planets = cfg.planets || [];
    drawOrbitPaths(planets, sx, sy, scaleR);
    const placedPlanets = placeOrbitingBodies(planets, sx, sy, scaleR, t);

    placedPlanets.filter((p) => p.depth < 0).forEach(drawPlanetBody);
    placed.filter((p) => p.depth < 0).forEach(drawRock);
    drawSun(sx, sy, t, cfg.star, 0.030);
    drawLabel(cfg.star.name, sx, sy + Math.min(width, height) * 0.030 + 16, 0.4);
    placed.filter((p) => p.depth >= 0).forEach(drawRock);
    placedPlanets.filter((p) => p.depth >= 0).forEach(drawPlanetBody);
  }

  // Engine trail left behind while the ship burns (departure/arrival)
  function drawTrail(t) {
    if (trailActive) {
      const r = shipWrap.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      trail.push({ x: r.left - c.left + 12, y: r.top - c.top + r.height / 2, born: t });
    }
    while (trail.length && t - trail[0].born > 900) trail.shift();
    if (trail.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const age = (t - trail[i].born) / 900;
      ctx.strokeStyle = "rgba(127, 228, 255, " + ((1 - age) * 0.55) + ")";
      ctx.lineWidth = (1 - age) * 5 + 0.5;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLabel(text, x, y, alpha) {
    ctx.fillStyle = "rgba(120, 200, 220, " + (alpha || 0.5) + ")";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
  }

  // Project orbiting bodies onto squashed (isometric) ellipses around
  // a star. depth > 0 means in front of (below) the star.
  function placeOrbitingBodies(bodies, sx, sy, scaleR, t) {
    return bodies.map((b) => {
      const a = b.phase + t * b.speed;
      const depth = Math.sin(a);
      return {
        b,
        x: sx + Math.cos(a) * b.dist * scaleR,
        y: sy + depth * b.dist * scaleR * ISO_SQUASH,
        s: 1 + depth * 0.3, // pseudo-perspective: nearer = bigger
        depth,
      };
    });
  }

  function drawOrbitPaths(bodies, sx, sy, scaleR) {
    ctx.save();
    ctx.strokeStyle = "rgba(160, 200, 230, 0.10)";
    ctx.lineWidth = 1;
    for (const b of bodies) {
      ctx.beginPath();
      ctx.ellipse(sx, sy, b.dist * scaleR, b.dist * scaleR * ISO_SQUASH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlanetBody(p) {
    const r = p.b.r * p.s;
    if (p.b.ring) {
      ctx.strokeStyle = "rgba(200, 180, 255, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 1.9, r * 0.55, -0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawPlanet(p.x, p.y, r, p.b.c1, p.b.c2);
    drawLabel(p.b.name, p.x, p.y + r + 13);
  }

  function drawSolarSystem(t) {
    const scaleR = Math.min(width * 0.52, height * 1.1);
    const sx = width * 0.5, sy = height * 0.5;

    drawOrbitPaths(SOLAR_BODIES, sx, sy, scaleR);
    const placed = placeOrbitingBodies(SOLAR_BODIES, sx, sy, scaleR, t);

    function drawBody(p) {
      if (p.b.home) {
        const r = p.b.r * p.s;
        // atmosphere glow + the station we are docked at
        ctx.save();
        ctx.shadowColor = "#5aa8e8";
        ctx.shadowBlur = 18;
        drawPlanet(p.x, p.y, r, p.b.c1, p.b.c2);
        ctx.restore();
        const stScale = 0.55 * p.s;
        const stX = p.x + r * 2.0;
        const stY = p.y - r * 1.2;
        drawStation(t, stX, stY, stScale);
        drawLabel("ASTERION STATION", stX, stY + 48 * stScale + 12, 0.6);
        // the docked ship sits just right of the station, sharing its depth
        dockPos = { x: stX + 90 * stScale, y: stY + 10 * stScale, s: 0.65 * p.s };
        drawLabel(p.b.name, p.x, p.y + r + 13);
      } else {
        drawPlanetBody(p);
      }
    }

    placed.filter((p) => p.depth < 0).sort((a, b) => a.y - b.y).forEach(drawBody);
    drawSun(sx, sy, t);
    drawLabel(SUN_NAME, sx, sy + Math.min(width, height) * 0.045 + 18);
    placed.filter((p) => p.depth >= 0).sort((a, b) => a.y - b.y).forEach(drawBody);
  }

  function drawStation(t, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // rotating ring assembly
    ctx.save();
    ctx.rotate(t * 0.00008);

    // outer + inner ring
    ctx.strokeStyle = "rgba(120, 200, 220, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(120, 200, 220, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 41, 0, Math.PI * 2);
    ctx.stroke();

    // spokes + habitat pods
    ctx.strokeStyle = "rgba(120, 200, 220, 0.6)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(ca * 16, sa * 16);
      ctx.lineTo(ca * 48, sa * 48);
      ctx.stroke();
      // pod halfway along the spoke
      ctx.fillStyle = "rgba(25, 55, 78, 0.95)";
      ctx.beginPath();
      ctx.arc(ca * 30, sa * 30, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // ring window lights (alternating blink)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const on = (i + Math.floor(t / 900)) % 3 !== 0;
      ctx.fillStyle = on ? "rgba(255, 220, 150, 0.9)" : "rgba(255, 220, 150, 0.15)";
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 44.5, Math.sin(a) * 44.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // central hub (does not rotate) — shaded sphere with window band
    const g = ctx.createRadialGradient(-5, -5, 2, 0, 0, 17);
    g.addColorStop(0, "#4a7a9a");
    g.addColorStop(0.6, "#1c3c54");
    g.addColorStop(1, "#0a1c2c");
    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(120, 200, 220, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // window band
    ctx.fillStyle = "rgba(150, 230, 255, 0.8)";
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * 5 - 1.5, -2, 3, 3.5);
    }

    // comms antenna + beacon
    ctx.strokeStyle = "rgba(120, 200, 220, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(0, -32);
    ctx.moveTo(-4, -26);
    ctx.lineTo(4, -26);
    ctx.stroke();
    if (Math.floor(t / 700) % 2 === 0) {
      ctx.fillStyle = "#ff5a5a";
      ctx.shadowColor = "#ff5a5a";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, -33, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAsteroids(t) {
    for (const a of asteroids) {
      const bob = Math.sin(t * 0.0004 + a.phase) * a.drift;
      ctx.save();
      ctx.translate(a.x, a.y + bob);
      if (a.glow) {
        ctx.shadowColor = a.glow;
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = a.color;
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      a.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function shipNose() {
    // approximate ship nose position in canvas coords
    const r = shipWrap.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    return { x: r.right - c.left - 8, y: r.top - c.top + r.height / 2 };
  }

  function drawMiningBeam(t) {
    if (!beamActive || asteroids.length === 0) return;
    const target = asteroids[0];
    const bob = Math.sin(t * 0.0004 + target.phase) * target.drift;
    const tip = shipNose();
    const tx = target.x, ty = target.y + bob;

    const flicker = 0.5 + 0.5 * Math.sin(t * 0.02);
    ctx.save();
    ctx.strokeStyle = "rgba(64, 255, 200, " + (0.35 + flicker * 0.4) + ")";
    ctx.lineWidth = 2 + flicker * 2;
    ctx.shadowColor = "#40ffc8";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();

    // spawn particles drifting from asteroid to ship
    if (Math.random() < 0.3) {
      particles.push({ x: tx, y: ty, t: 0, sx: tx, sy: ty, ex: tip.x, ey: tip.y });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += 0.02;
      if (p.t >= 1) { particles.splice(i, 1); continue; }
      const px = p.sx + (p.ex - p.sx) * p.t;
      const py = p.sy + (p.ey - p.sy) * p.t + Math.sin(p.t * 10) * 4;
      ctx.fillStyle = "rgba(120, 255, 220, " + (1 - p.t) + ")";
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBackground(t) {
    // base gradient by scene
    let top = "#040816", bottom = "#0a1228";
    if (activeScene === "crystalField") { top = "#041020"; bottom = "#0a2038"; }
    if (activeScene === "voidField") { top = "#0a0414"; bottom = "#180a2a"; }
    if (activeScene === "transit") { top = "#020610"; bottom = "#061226"; }
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    const warp = activeScene === "transit";
    if (!warp) {
      drawGalaxy(width * 0.2, height * 0.2, 140, 50, "rgba(110, 80, 200, 0.12)", 0.5);
      drawGalaxy(width * 0.85, height * 0.7, 110, 40, "rgba(60, 160, 200, 0.10)", -0.3);
    }
    drawStars(t, warp);

    if (activeScene === "station") {
      drawSolarSystem(t);
    } else if (MINING_SCENE_CFG[activeScene]) {
      if (activeScene === "voidField") {
        drawGalaxy(width * 0.5, height * 0.3, 260, 130, "rgba(150, 80, 255, 0.10)", 0.2);
      }
      drawBeltAndStar(t, MINING_SCENE_CFG[activeScene]);
    }
    drawAsteroids(t);
    drawMiningBeam(t);
    drawTrail(t);
  }

  // While at the station the ship is parked beside it and orbits along;
  // everywhere else it sits at its default scene position.
  function positionShip() {
    if (activeScene === "station" && dockPos) {
      shipWrap.style.left = dockPos.x + "px";
      shipWrap.style.top = dockPos.y - 34 + "px";
      shipWrap.style.bottom = "auto";
      shipWrap.style.scale = String(dockPos.s);
    } else {
      shipWrap.style.left = "50%";
      shipWrap.style.top = "auto";
      shipWrap.style.bottom = "22%";
      shipWrap.style.scale = "1";
    }
  }

  function frame(t) {
    if (width > 0) {
      drawBackground(t);
      positionShip();
    }
    requestAnimationFrame(frame);
  }

  // ---------- ship animation ----------

  function setShipMode(mode) {
    // modes: docked | flying | mining
    shipWrap.classList.toggle("flying", mode === "flying");
    shipWrap.classList.toggle("mining", mode === "mining");
    shipWrap.classList.toggle("docked", mode === "docked");
    beamActive = mode === "mining";
  }

  function playDeparture(onMidpoint) {
    if (transitioning) return;
    transitioning = true;
    setShipMode("flying");

    // Ship burns straight ahead (it faces right), slight climb,
    // leaving an engine trail behind.
    trail = [];
    trailActive = true;
    const dx = width * 1.1;
    const dy = -height * 0.12;
    shipWrap.style.transition = "transform 2.2s cubic-bezier(0.6, 0, 1, 0.6)";
    shipWrap.style.transform = "translate(" + dx + "px, " + dy + "px) scale(0.55)";

    setTimeout(() => {
      trailActive = false;
      fadeEl.classList.add("active");
      setTimeout(() => {
        if (onMidpoint) onMidpoint(); // swap scene while screen is dark
        // arrive flying in from the left edge, decelerating
        shipWrap.style.transition = "none";
        shipWrap.style.transform = "translate(" + -width * 0.8 + "px, " + height * 0.1 + "px) scale(0.6)";
        fadeEl.classList.remove("active");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          trail = [];
          trailActive = true;
          shipWrap.style.transition = "transform 1.8s cubic-bezier(0, 0.6, 0.3, 1)";
          shipWrap.style.transform = "translate(0, 0) scale(1)";
          setTimeout(() => {
            trailActive = false;
            transitioning = false;
          }, 1900);
        }));
      }, 600);
    }, 2200);
  }

  // Switch scene with a quick fade (used on refresh/phase change without
  // full departure animation).
  function setScene(scene, animate) {
    if (scene === activeScene) return;
    if (animate === false || transitioning) {
      activeScene = scene;
      buildSceneObjects();
      return;
    }
    transitioning = true;
    fadeEl.classList.add("active");
    setTimeout(() => {
      activeScene = scene;
      buildSceneObjects();
      fadeEl.classList.remove("active");
      transitioning = false;
    }, 600);
  }

  function getScene() { return activeScene; }
  function isTransitioning() { return transitioning; }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);

  return { setScene, getScene, playDeparture, setShipMode, isTransitioning };
})();
