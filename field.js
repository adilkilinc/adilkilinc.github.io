// Fig. 1: a pixel-per-element mesh coloured by a synthetic equivalent-strain field.
// The field is decorative: Voronoi grains, slip-like bands inside each grain,
// one macroscopic shear band, and a little boundary and noise contribution.
(() => {
  const canvas = document.getElementById("field");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  const out = {
    inc: document.getElementById("probe-inc"),
    elem: document.getElementById("probe-elem"),
    grain: document.getElementById("probe-grain"),
    val: document.getElementById("probe-val"),
  };

  const LANG = (document.documentElement.lang || "en").slice(0, 2);
  const EMPTY = "\u2014"; // em dash when no element is probed
  const fmt3 = new Intl.NumberFormat(LANG, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const N_INC = 20;
  const EPS_MAX = 0.12; // colour-bar maximum, matches the legend
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // viridis, 5 stops
  const STOPS = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const colour = (t) => {
    t = Math.min(1, Math.max(0, t));
    const s = t * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(s));
    const f = s - i;
    const a = STOPS[i], b = STOPS[i + 1];
    return `rgb(${(a[0] + (b[0] - a[0]) * f) | 0},${(a[1] + (b[1] - a[1]) * f) | 0},${(a[2] + (b[2] - a[2]) * f) | 0})`;
  };

  // Seeded RNG so the field is the same on every visit.
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let cols = 0, rows = 0, cell = 10, gap = 1, ox = 0, oy = 0, cssW = 0, cssH = 0;
  let field = new Float32Array(0), grainOf = new Int32Array(0), mean = 0;
  let inc = N_INC, hover = -1;

  function build() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cell = cssW < 640 ? 8 : 10;
    gap = 1;
    cols = Math.floor(cssW / cell);
    rows = Math.floor(cssH / cell);
    ox = Math.floor((cssW - cols * cell) / 2);
    oy = Math.floor((cssH - rows * cell) / 2);

    const r = rng(316);
    // Grain size in elements, independent of screen width.
    const nGrains = Math.max(12, Math.round((cols * rows) / 190));
    const grains = [];
    for (let g = 0; g < nGrains; g++) {
      grains.push({
        x: r() * cols,
        y: r() * rows,
        th: r() * Math.PI,               // slip-band orientation
        k: 0.55 + r() * 0.45,            // band spacing
        ph: r() * Math.PI * 2,
        soft: 0.2 + r() * 0.8,           // how readily the grain deforms
        act: r() < 0.65 ? 0.7 + r() * 0.5 : 0.1, // some grains barely slip
      });
    }

    // One macroscopic shear band through the specimen, kept clear of the title block.
    const a = (-36 * Math.PI) / 180;
    const cx = cols * 0.66, cy = rows * 0.5;
    const width = Math.max(3.5, rows * 0.085);

    field = new Float32Array(cols * rows);
    grainOf = new Int32Array(cols * rows);
    let sum = 0;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i + 0.5, y = j + 0.5;
        let d1 = Infinity, d2 = Infinity, n1 = 0;
        for (let g = 0; g < nGrains; g++) {
          const dx = x - grains[g].x, dy = y - grains[g].y;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; n1 = g; }
          else if (d < d2) { d2 = d; }
        }
        const G = grains[n1];
        const boundary = Math.exp(-(Math.sqrt(d2) - Math.sqrt(d1)) / 0.8);
        const u = x * Math.cos(G.th) + y * Math.sin(G.th);
        const band = Math.pow(0.5 + 0.5 * Math.sin(u * G.k + G.ph), 10);
        const dl = (x - cx) * Math.sin(a) - (y - cy) * Math.cos(a);
        const macro = Math.exp(-(dl * dl) / (2 * width * width));
        const noise = (r() - 0.5) * 0.04;

        const v =
          0.42 * G.soft +
          0.5 * band * G.act * (0.45 + 0.8 * macro) +
          0.38 * macro * (0.4 + G.soft) +
          0.07 * boundary +
          noise;

        const k = j * cols + i;
        field[k] = Math.max(0, v);
        grainOf[k] = n1;
      }
    }
    // Scale to the 99.5th percentile so a few hot elements saturate, as in a real field.
    const sorted = Float32Array.from(field).sort();
    const top = sorted[Math.floor(sorted.length * 0.995)] || 1;
    for (let k = 0; k < field.length; k++) { field[k] = Math.min(1, field[k] / top); sum += field[k]; }
    mean = sum / field.length;
  }

  // At early increments the field is nearly uniform; localisation grows with load.
  const valueAt = (k, n) => {
    const t = n / N_INC;
    return t * (mean + (field[k] - mean) * t);
  };

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);
    const s = cell - gap;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        ctx.fillStyle = colour(valueAt(k, inc));
        ctx.fillRect(ox + i * cell, oy + j * cell, s, s);
      }
    }
    if (hover >= 0) {
      const i = hover % cols, j = (hover / cols) | 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#fff";
      ctx.strokeRect(ox + i * cell - 2, oy + j * cell - 2, s + 4, s + 4);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#15212b";
      ctx.strokeRect(ox + i * cell - 3.5, oy + j * cell - 3.5, s + 7, s + 7);
    }
    out.inc.textContent = `${inc}/${N_INC}`;
  }

  function probe() {
    if (hover < 0) {
      out.elem.textContent = EMPTY;
      out.grain.textContent = EMPTY;
      out.val.textContent = EMPTY;
      return;
    }
    out.elem.textContent = String(hover + 1);
    out.grain.textContent = String(grainOf[hover] + 1);
    out.val.textContent = fmt3.format(valueAt(hover, inc) * EPS_MAX);
  }

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const i = Math.floor((ev.clientX - rect.left - ox) / cell);
    const j = Math.floor((ev.clientY - rect.top - oy) / cell);
    const k = i >= 0 && i < cols && j >= 0 && j < rows ? j * cols + i : -1;
    if (k !== hover) { hover = k; draw(); probe(); }
  }

  canvas.addEventListener("pointermove", pick);
  canvas.addEventListener("pointerdown", pick);
  canvas.addEventListener("pointerleave", () => { hover = -1; draw(); probe(); });

  function play() {
    if (reduceMotion) { inc = N_INC; draw(); return; }
    inc = 0;
    const t0 = performance.now(), dur = 1800;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      // ease-out so the last increments settle
      const n = Math.round(N_INC * (1 - Math.pow(1 - p, 2)));
      if (n !== inc) { inc = n; draw(); probe(); }
      if (p < 1) requestAnimationFrame(step);
    };
    draw();
    requestAnimationFrame(step);
  }

  let resizeTimer = 0, lastW = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (canvas.clientWidth === lastW) return; // ignore mobile toolbar height changes
      lastW = canvas.clientWidth;
      hover = -1;
      build(); draw(); probe();
    }, 150);
  });

  lastW = canvas.clientWidth;
  build();
  play();
})();
