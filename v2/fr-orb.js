// ── FINOVA ORB ────────────────────────────────────────────────────────────────
// Animated particle-sphere canvas used on the Login screen and the FINOVA
// Advisor context rail. Points are laid out on a sphere (Fibonacci lattice),
// rotated each frame, connected by proximity, with a warm core glow.
(function () {
  const orbs = new WeakMap();

  function buildPoints(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = Math.PI * (3 - Math.sqrt(5)) * i;
      pts.push({ x: Math.cos(th) * r, y: y, z: Math.sin(th) * r, tw: Math.random() * 6.283 });
    }
    return pts;
  }

  function drawFrame(cv, pts, t) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W * 0.36;
    ctx.clearRect(0, 0, W, H);

    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.9);
    halo.addColorStop(0, 'rgba(0,229,160,.16)');
    halo.addColorStop(0.45, 'rgba(0,180,140,.05)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    const cos = Math.cos(t), sin = Math.sin(t), cos2 = Math.cos(t * 0.42), sin2 = Math.sin(t * 0.42);
    const proj = pts.map(p => {
      let x = p.x * cos - p.z * sin, z = p.x * sin + p.z * cos;
      let y = p.y * cos2 - z * sin2; z = p.y * sin2 + z * cos2;
      const s = 1 / (1.9 - z * 0.55);
      return { sx: cx + x * R * s * 1.55, sy: cy + y * R * s * 1.55, z: z, s: s, tw: p.tw };
    });

    for (let i = 0; i < proj.length; i++) {
      for (let j = i + 1; j < proj.length; j++) {
        const dx = proj[i].sx - proj[j].sx, dy = proj[i].sy - proj[j].sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < (R * 0.34) * (R * 0.34)) {
          const a = (1 - Math.sqrt(d2) / (R * 0.34)) * 0.3 * ((proj[i].z + proj[j].z) / 2 + 1.2) / 2.2;
          ctx.strokeStyle = 'rgba(0,229,160,' + a.toFixed(3) + ')';
          ctx.lineWidth = W * 0.0018;
          ctx.beginPath();
          ctx.moveTo(proj[i].sx, proj[i].sy);
          ctx.lineTo(proj[j].sx, proj[j].sy);
          ctx.stroke();
        }
      }
    }

    proj.forEach(p => {
      const tw = 0.55 + 0.45 * Math.sin(t * 7 + p.tw);
      const rad = Math.max(0.6, W * 0.0055 * p.s * tw);
      const a = Math.min(1, (p.z + 1.2) / 2.2) * tw;
      ctx.fillStyle = 'rgba(120,255,215,' + (a * 0.9).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, rad, 0, 6.283);
      ctx.fill();
    });

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    core.addColorStop(0, 'rgba(255,240,190,.95)');
    core.addColorStop(0.22, 'rgba(255,201,71,.5)');
    core.addColorStop(0.6, 'rgba(0,229,160,.12)');
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, 6.283);
    ctx.fill();
  }

  function initFinovaOrb(canvas) {
    if (!canvas || orbs.has(canvas)) return;
    const state = { stopped: false };
    orbs.set(canvas, state);
    const pts = buildPoints(150);
    let t = 0;
    const loop = () => {
      if (state.stopped) return;
      requestAnimationFrame(loop);
      t += 0.0042;
      drawFrame(canvas, pts, t);
    };
    loop();
  }

  function stopFinovaOrb(canvas) {
    const state = orbs.get(canvas);
    if (state) state.stopped = true;
    orbs.delete(canvas);
  }

  function initFinovaOrbsIn(root) {
    (root || document).querySelectorAll('canvas[data-orb]').forEach(initFinovaOrb);
  }

  function stopFinovaOrbsIn(root) {
    (root || document).querySelectorAll('canvas[data-orb]').forEach(stopFinovaOrb);
  }

  window.initFinovaOrb = initFinovaOrb;
  window.stopFinovaOrb = stopFinovaOrb;
  window.initFinovaOrbsIn = initFinovaOrbsIn;
  window.stopFinovaOrbsIn = stopFinovaOrbsIn;
})();
