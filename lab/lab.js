// Simulator page: controls, drawing, drag-to-load and the force–displacement curve.
(() => {
  const FE = window.FE;
  const canvas = document.getElementById("lab-canvas");
  if (!FE || !canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  // ---------- Language ----------
  const LANG = (document.documentElement.lang || "en").slice(0, 2) === "fr" ? "fr" : "en";
  const T = {
    fr: {
      amp: (n) => `Déformée amplifiée ×${n}`,
      hint: {
        tension: "Faites glisser vers la droite pour tirer",
        compression: "Faites glisser vers la gauche pour comprimer",
        bending: "Faites glisser vers le bas pour fléchir",
      },
      yieldSym: "R<sub>e</sub>",
      cbSeq: "Contrainte de von Mises",
      cbU: "Déplacement",
      over: "au-delà de R<sub>e</sub>",
      yieldLabel: "Première plastification",
      xAxis: "Déplacement imposé, d (mm)",
      yAxis: (u) => `Effort, F (${u})`,
      busy: "Calcul en cours…",
      failed: "Le calcul a échoué.",
      vCant: "Poutre console, effort pour 1 mm de flèche",
      vCantRef: "poutre de Timoshenko",
      vPlate: "Plaque trouée en traction, K<sub>t,net</sub>",
      vPlateRef: "Heywood",
      pct: " %",
    },
    en: {
      amp: (n) => `Deformation magnified ×${n}`,
      hint: {
        tension: "Drag right to pull",
        compression: "Drag left to compress",
        bending: "Drag down to bend",
      },
      yieldSym: "σ<sub>y</sub>",
      cbSeq: "Von Mises stress",
      cbU: "Displacement",
      over: "above σ<sub>y</sub>",
      yieldLabel: "First yield",
      xAxis: "Imposed displacement, d (mm)",
      yAxis: (u) => `Force, F (${u})`,
      busy: "Solving…",
      failed: "The analysis failed.",
      vCant: "Cantilever, force for a 1 mm tip deflection",
      vCantRef: "Timoshenko beam",
      vPlate: "Plate with a hole in tension, K<sub>t,net</sub>",
      vPlateRef: "Heywood",
      pct: "%",
    },
  }[LANG];

  const formats = new Map();
  const fmt = (x, d) => {
    if (!formats.has(d)) formats.set(d, new Intl.NumberFormat(LANG, { minimumFractionDigits: d, maximumFractionDigits: d }));
    return formats.get(d).format(x);
  };
  const NB = " ";
  const decimalsFor = (v) => Math.max(0, 2 - Math.floor(Math.log10(Math.max(v, 1e-12))));

  // Indicative room-temperature properties (MPa)
  const MATERIALS = {
    "316l": { E: 205000, nu: 0.3, sy: 250 },
    s355: { E: 210000, nu: 0.3, sy: 355 },
    al6061: { E: 68900, nu: 0.33, sy: 276 },
    ti64: { E: 113800, nu: 0.342, sy: 880 },
    cu: { E: 115000, nu: 0.34, sy: 70 },
  };

  // viridis, sampled into bins so each frame fills one path per colour
  const STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const NBIN = 64;
  const PALETTE = Array.from({ length: NBIN }, (_, i) => {
    const t = i / (NBIN - 1), s = t * (STOPS.length - 1);
    const k = Math.min(STOPS.length - 2, Math.floor(s)), f = s - k, a = STOPS[k], b = STOPS[k + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Models and results, cached ----------
  const shapes = {}, results = {};
  function getShape(id) {
    if (shapes[id]) return shapes[id];
    const model = FE.SHAPES[id]();
    const { x, y, elems } = model.mesh;
    const count = new Map();
    for (let e = 0; e < elems.length; e += 4)
      for (let a = 0; a < 4; a++) {
        const p = elems[e + a], q = elems[e + ((a + 1) % 4)];
        const key = p < q ? p * 1e6 + q : q * 1e6 + p;
        count.set(key, (count.get(key) || 0) + 1);
      }
    const edges = [], boundary = [];
    for (const [key, c] of count) {
      const p = Math.floor(key / 1e6), q = key % 1e6;
      edges.push(p, q);
      if (c === 1) boundary.push(p, q);
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < x.length; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]); }
    return (shapes[id] = { model, edges: Int32Array.from(edges), boundary: Int32Array.from(boundary), bbox: { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 } });
  }
  function getResult(shape, load, mat) {
    const key = `${shape}|${load}|${mat}`;
    if (!results[key]) { const m = MATERIALS[mat]; results[key] = FE.analyse(getShape(shape).model, load, m.E, m.nu); }
    return results[key];
  }
  const cached = (shape, load, mat) => Boolean(results[`${shape}|${load}|${mat}`]);

  // ---------- State ----------
  const state = { shape: "dogbone", load: "tension", mat: "316l", field: "seq", mesh: true, d: 0 };
  let S = null, R = null, V = null; // shape geometry, analysis, view parameters

  const niceFloor = (v) => {
    const k = Math.pow(10, Math.floor(Math.log10(v))), m = v / k;
    return Math.max(1, (m >= 5 ? 5 : m >= 2 ? 2 : 1) * k);
  };

  function configure() {
    S = getShape(state.shape);
    R = getResult(state.shape, state.load, state.mat);
    const m = MATERIALS[state.mat];
    const dy = m.sy / R.seqMax, dmax = 1.5 * dy; // the slider runs 50 % past first yield
    const N = niceFloor((0.12 * Math.max(S.bbox.w, S.bbox.h)) / (dmax * R.umax));
    const Fmax = R.force * dmax;
    const kN = Fmax >= 1000;
    V = {
      m, dy, dmax, N, Fmax,
      dDec: decimalsFor(dmax),
      fUnit: kN ? "kN" : "N",
      fDiv: kN ? 1000 : 1,
      fDec: kN ? decimalsFor(Fmax / 1000) : 0,
      umaxAt: R.umax * dmax,
    };
    state.d = 0;
    canvas.style.touchAction = R.bc.edge ? "pan-x" : "pan-y";
    stage.classList.remove("is-busy");
    fit();
    updateLegend();
    render();
  }

  // ---------- Layout: fit the specimen and its deformed shape in the canvas ----------
  const stage = canvas.closest(".lab__stage");
  let dpr = 1, W = 0, H = 0;
  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x, y } = S.model.mesh, u = R.u, s = V.N * V.dmax;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const add = (px, py) => { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); };
    for (let i = 0; i < x.length; i++) { add(x[i], y[i]); add(x[i] + s * u[2 * i], y[i] + s * u[2 * i + 1]); }
    const fr = S.model.fixedRect;
    if (!S.model.wall) { add(fr[0], fr[2]); add(fr[1], fr[3]); }
    if (!R.bc.edge) {
      const mr = S.model.movingRect, dx = s * R.bc.dir[0];
      add(mr[0] + dx, mr[2]); add(mr[1] + dx, mr[3]);
    }
    const padX = 30, padTop = 56, padBottom = 26;
    const extraX = S.model.wall ? 22 : 0, extraTop = R.bc.edge ? 44 : 0;
    const k = Math.min((W - 2 * padX - extraX) / (x1 - x0), (H - padTop - padBottom - extraTop) / (y1 - y0));
    V.k = k;
    V.cx = (x0 + x1) / 2; V.cy = (y0 + y1) / 2;
    V.ox = W / 2 + extraX / 2;
    V.oy = padTop + extraTop + (H - padTop - padBottom - extraTop) / 2;
  }
  const sx = (x) => V.ox + (x - V.cx) * V.k;
  const sy = (y) => V.oy - (y - V.cy) * V.k;

  // ---------- Drawing ----------
  let px = new Float32Array(0), py = new Float32Array(0);

  function colours() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    return { ink: v("--ink"), paper: v("--paper"), muted: v("--muted"), rule: v("--rule"), accent: v("--accent"), warn: v("--warn") };
  }

  function hatched(c, x0, y0, x1, y1) {
    const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    ctx.save();
    ctx.beginPath(); ctx.rect(l, t, w, h);
    ctx.globalAlpha = 0.94; ctx.fillStyle = c.paper; ctx.fill(); ctx.globalAlpha = 1;
    ctx.clip();
    ctx.beginPath();
    for (let s = -h; s < w + h; s += 7) { ctx.moveTo(l + s, t + h); ctx.lineTo(l + s + h, t); }
    ctx.strokeStyle = c.muted; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.strokeRect(l, t, w, h);
  }

  function arrow(c, x0, y0, x1, y1, colour, width) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - 8 * Math.cos(a - 0.45), y1 - 8 * Math.sin(a - 0.45)); ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - 8 * Math.cos(a + 0.45), y1 - 8 * Math.sin(a + 0.45));
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
  }

  function draw() {
    const c = colours();
    ctx.clearRect(0, 0, W, H);
    const { x, y, elems } = S.model.mesh, nn = x.length, u = R.u;
    const amp = state.d * V.N;
    if (px.length !== nn) { px = new Float32Array(nn); py = new Float32Array(nn); }
    for (let i = 0; i < nn; i++) { px[i] = sx(x[i] + amp * u[2 * i]); py[i] = sy(y[i] + amp * u[2 * i + 1]); }

    // undeformed outline
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = c.muted; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < S.boundary.length; k += 2) {
      const p = S.boundary[k], q = S.boundary[k + 1];
      ctx.moveTo(sx(x[p]), sy(y[p])); ctx.lineTo(sx(x[q]), sy(y[q]));
    }
    ctx.stroke();
    ctx.restore();

    // field, on four sub-cells per element coloured by the corner values
    const val = new Float32Array(nn);
    if (state.field === "seq") for (let i = 0; i < nn; i++) val[i] = (state.d * R.seq[i]) / V.m.sy;
    else for (let i = 0; i < nn; i++) val[i] = (state.d * Math.hypot(u[2 * i], u[2 * i + 1])) / V.umaxAt;
    const over = state.field === "seq";
    const paths = Array.from({ length: NBIN + 1 }, () => new Path2D());
    const bin = (t) => (over && t > 1 + 1e-9 ? NBIN : Math.min(NBIN - 1, Math.max(0, Math.floor(t * NBIN))));
    for (let e = 0; e < elems.length; e += 4) {
      const n0 = elems[e], n1 = elems[e + 1], n2 = elems[e + 2], n3 = elems[e + 3];
      const X = [px[n0], px[n1], px[n2], px[n3]], Y = [py[n0], py[n1], py[n2], py[n3]], N4 = [n0, n1, n2, n3];
      const cx = (X[0] + X[1] + X[2] + X[3]) / 4, cy = (Y[0] + Y[1] + Y[2] + Y[3]) / 4;
      for (let a = 0; a < 4; a++) {
        const b = (a + 1) % 4, z = (a + 3) % 4;
        const p = paths[bin(val[N4[a]])];
        p.moveTo(X[a], Y[a]);
        p.lineTo((X[a] + X[b]) / 2, (Y[a] + Y[b]) / 2);
        p.lineTo(cx, cy);
        p.lineTo((X[a] + X[z]) / 2, (Y[a] + Y[z]) / 2);
        p.closePath();
      }
    }
    ctx.lineWidth = 0.7; ctx.lineJoin = "round";
    paths.forEach((p, i) => {
      const col = i === NBIN ? c.warn : PALETTE[i];
      ctx.fillStyle = col; ctx.strokeStyle = col;
      ctx.fill(p); ctx.stroke(p);
    });

    // mesh
    if (state.mesh) {
      ctx.beginPath();
      for (let k = 0; k < S.edges.length; k += 2) { const p = S.edges[k], q = S.edges[k + 1]; ctx.moveTo(px[p], py[p]); ctx.lineTo(px[q], py[q]); }
      ctx.globalAlpha = 0.4; ctx.strokeStyle = c.paper; ctx.lineWidth = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    }

    // deformed outline
    ctx.beginPath();
    for (let k = 0; k < S.boundary.length; k += 2) { const p = S.boundary[k], q = S.boundary[k + 1]; ctx.moveTo(px[p], py[p]); ctx.lineTo(px[q], py[q]); }
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.25; ctx.stroke();

    // supports and loading
    const fr = S.model.fixedRect;
    if (S.model.wall) {
      const xw = sx(0), yt = sy(S.bbox.y1) - 10, yb = sy(S.bbox.y0) + 10;
      hatched(c, xw - 16, yt, xw, yb);
    } else {
      hatched(c, sx(fr[0]), sy(fr[3]), sx(fr[1]), sy(fr[2]));
    }
    const hint = state.d === 0 && !dragging;
    if (R.bc.edge) {
      let ex = 0, ey = 0, top = Infinity;
      for (const i of R.bc.moving) { ex += px[i]; ey += py[i]; top = Math.min(top, py[i]); }
      ex /= R.bc.moving.length;
      ctx.fillStyle = c.ink;
      ctx.fillRect(ex - 3, top - 5, 6, 5);
      arrow(c, ex, top - 42, ex, top - 8, hint ? c.accent : c.ink, 2);
      ctx.beginPath(); ctx.arc(ex, top - 46, 5, 0, 2 * Math.PI);
      ctx.fillStyle = c.paper; ctx.fill(); ctx.strokeStyle = hint ? c.accent : c.ink; ctx.lineWidth = 2; ctx.stroke();
    } else {
      const mr = S.model.movingRect, dx = amp * R.bc.dir[0];
      const l = sx(mr[0] + dx), r = sx(mr[1] + dx), t = sy(mr[3]), b = sy(mr[2]);
      hatched(c, l, t, r, b);
      if (hint) {
        const ym = (t + b) / 2, dir = R.bc.dir[0];
        const x0 = dir > 0 ? r + 8 : l - 8;
        arrow(c, x0, ym, x0 + dir * 30, ym, c.accent, 2);
      }
    }

    // peak stress marker
    if (state.d > 0 && state.field === "seq") {
      const i = R.seqMaxNode;
      ctx.beginPath(); ctx.arc(px[i], py[i], 7, 0, 2 * Math.PI);
      ctx.strokeStyle = c.paper; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.stroke();
    }

    $("lab-amp").textContent = T.amp(fmt(V.N, 0));
    $("lab-hint").textContent = hint ? T.hint[state.load] : "";
  }

  // ---------- Force–displacement curve ----------
  const curve = $("lab-curve");
  const SVG = "http://www.w3.org/2000/svg";
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  };
  const niceStep = (raw) => {
    const k = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / k;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * k;
  };
  const stepDecimals = (st) => Math.max(0, -Math.floor(Math.log10(st) + 1e-9) + (Math.abs(st / Math.pow(10, Math.floor(Math.log10(st))) - 2.5) < 1e-9 ? 1 : 0));

  function drawCurve() {
    while (curve.firstChild) curve.removeChild(curve.firstChild);
    const X0 = 66, X1 = 620, Y0 = 208, Y1 = 30;
    const fTop = (V.Fmax / V.fDiv) * 1.08;
    const xs = (d) => X0 + (d / V.dmax) * (X1 - X0);
    const ys = (F) => Y0 - (F / fTop) * (Y0 - Y1);

    const xStep = niceStep(V.dmax / 4), yStep = niceStep(fTop / 4);
    const xd = stepDecimals(xStep), yd = stepDecimals(yStep);
    for (let v = 0; v <= V.dmax + 1e-12; v += xStep) {
      el("line", { x1: xs(v), y1: Y0, x2: xs(v), y2: Y1, class: "c-rule" }, curve);
      el("text", { x: xs(v), y: Y0 + 18, class: "c-text", "text-anchor": "middle" }, curve).textContent = fmt(v, xd);
    }
    for (let v = 0; v <= fTop + 1e-12; v += yStep) {
      el("line", { x1: X0, y1: ys(v), x2: X1, y2: ys(v), class: "c-rule" }, curve);
      el("text", { x: X0 - 8, y: ys(v) + 4, class: "c-text", "text-anchor": "end" }, curve).textContent = fmt(v, yd);
    }
    el("line", { x1: X0, y1: Y0, x2: X1, y2: Y0, class: "c-axis" }, curve);
    el("line", { x1: X0, y1: Y0, x2: X0, y2: Y1 - 8, class: "c-axis" }, curve);
    el("text", { x: X1, y: Y0 + 38, class: "c-text", "text-anchor": "end" }, curve).textContent = T.xAxis;
    el("text", { x: X0, y: Y1 - 16, class: "c-title" }, curve).textContent = T.yAxis(V.fUnit);

    const Fy = (R.force * V.dy) / V.fDiv, Fm = V.Fmax / V.fDiv;
    el("line", { x1: xs(0), y1: ys(0), x2: xs(V.dy), y2: ys(Fy), class: "c-line" }, curve);
    el("line", { x1: xs(V.dy), y1: ys(Fy), x2: xs(V.dmax), y2: ys(Fm), class: "c-beyond" }, curve);
    el("circle", { cx: xs(V.dy), cy: ys(Fy), r: 5, class: "c-yield" }, curve);
    el("text", { x: xs(V.dy) - 10, y: ys(Fy) - 10, class: "c-label", "text-anchor": "end" }, curve).textContent = T.yieldLabel;

    if (state.d > 0) {
      const F = (R.force * state.d) / V.fDiv, cxp = xs(state.d), cyp = ys(F);
      el("line", { x1: cxp, y1: Y0, x2: cxp, y2: cyp, class: "c-guide" }, curve);
      el("line", { x1: X0, y1: cyp, x2: cxp, y2: cyp, class: "c-guide" }, curve);
      el("circle", { cx: cxp, cy: cyp, r: 5.5, class: state.d > V.dy * (1 + 1e-9) ? "c-now c-now--over" : "c-now" }, curve);
    }
  }

  // ---------- Readouts and legend ----------
  function readouts() {
    const d = state.d, s = d * R.seqMax;
    $("lab-r-d").textContent = `${fmt(d, V.dDec)}${NB}mm`;
    $("lab-r-f").textContent = `${fmt((d * R.force) / V.fDiv, V.fDec)}${NB}${V.fUnit}`;
    $("lab-r-s").textContent = `${fmt(s, 0)}${NB}MPa`;
    const ratio = $("lab-r-ratio");
    ratio.textContent = `${fmt((100 * s) / V.m.sy, 0)}${T.pct}`;
    ratio.classList.toggle("is-over", s > V.m.sy * (1 + 1e-9));
    slider.value = String(Math.round((1000 * d) / V.dmax));
  }

  function updateLegend() {
    const seq = state.field === "seq";
    $("lab-cb-title").textContent = seq ? T.cbSeq : T.cbU;
    $("lab-cb-max").innerHTML = seq
      ? `${fmt(V.m.sy, 0)}${NB}MPa (${T.yieldSym})`
      : `${fmt(V.umaxAt, decimalsFor(V.umaxAt))}${NB}mm`;
    $("lab-cb-over").hidden = !seq;
    $("lab-cb-over-label").innerHTML = T.over;
    const m = MATERIALS[state.mat];
    const eDec = (m.E / 1000) % 1 ? 1 : 0;
    $("lab-props").innerHTML = `E = ${fmt(m.E / 1000, eDec)}${NB}GPa, ν = ${fmt(m.nu, 2)}, ${T.yieldSym} = ${fmt(m.sy, 0)}${NB}MPa`;
  }

  function render() { draw(); drawCurve(); readouts(); }
  let pending = false;
  const scheduleRender = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  };

  // ---------- Interaction ----------
  const slider = $("lab-d");
  let anim = 0, dragging = false;
  const stopAnim = () => { if (anim) cancelAnimationFrame(anim); anim = 0; };
  const setD = (d) => { state.d = Math.max(0, Math.min(V.dmax, d)); };

  function run() {
    stopAnim();
    const d0 = state.d >= V.dmax * 0.999 ? 0 : state.d;
    if (reduceMotion) { setD(V.dmax); render(); return; }
    const t0 = performance.now(), dur = 2600 * (1 - d0 / V.dmax);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      setD(d0 + (V.dmax - d0) * p);
      render();
      anim = p < 1 ? requestAnimationFrame(step) : 0;
    };
    anim = requestAnimationFrame(step);
  }

  let start = null;
  canvas.addEventListener("pointerdown", (ev) => {
    if (!V || ev.button !== 0) return;
    stopAnim();
    dragging = true;
    start = { x: ev.clientX, y: ev.clientY, d: state.d };
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const dir = R.bc.dir; // screen y points down
    const along = (ev.clientX - start.x) * dir[0] - (ev.clientY - start.y) * dir[1];
    setD(start.d + along / (V.k * V.N));
    scheduleRender();
  });
  const endDrag = () => { if (!dragging) return; dragging = false; canvas.classList.remove("is-dragging"); scheduleRender(); };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  slider.addEventListener("input", () => { stopAnim(); setD((V.dmax * Number(slider.value)) / 1000); scheduleRender(); });
  $("lab-run").addEventListener("click", run);
  $("lab-reset").addEventListener("click", () => { stopAnim(); setD(0); render(); });

  const form = $("lab-form");
  form.addEventListener("submit", (e) => e.preventDefault());

  function syncLoads() {
    const allowed = getShape(state.shape).model.loads;
    form.querySelectorAll("[data-load]").forEach((lab) => { lab.hidden = !allowed.includes(lab.dataset.load); });
    if (!allowed.includes(state.load)) {
      state.load = allowed[0];
      form.querySelector(`input[name="load"][value="${state.load}"]`).checked = true;
    }
  }

  function reconfigure() {
    stopAnim();
    if (cached(state.shape, state.load, state.mat)) { configure(); return; }
    stage.classList.add("is-busy");
    $("lab-hint").textContent = T.busy;
    setTimeout(() => {
      try { configure(); }
      catch (err) { stage.classList.remove("is-busy"); $("lab-hint").textContent = T.failed; console.error(err); }
    }, 30);
  }

  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.name === "shape") { state.shape = t.value; syncLoads(); reconfigure(); }
    else if (t.name === "load") { state.load = t.value; reconfigure(); }
    else if (t.id === "lab-material") { state.mat = t.value; reconfigure(); }
    else if (t.name === "field") { state.field = t.value; updateLegend(); scheduleRender(); }
    else if (t.id === "lab-mesh") { state.mesh = t.checked; scheduleRender(); }
  });

  let lastW = 0;
  new ResizeObserver(() => {
    if (!V || canvas.clientWidth === lastW) return;
    lastW = canvas.clientWidth;
    fit(); render();
  }).observe(canvas);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => V && render());

  // ---------- Verification, recomputed in the browser ----------
  function verify() {
    const body = $("lab-verify");
    if (!body) return;
    const m = MATERIALS["316l"];
    const cant = getShape("cantilever").model, rc = getResult("cantilever", "bending", "316l");
    const { L, H: h, t } = cant.beam;
    const I = (t * h ** 3) / 12, A = t * h, Gm = m.E / (2 * (1 + m.nu));
    const Fref = 1 / (L ** 3 / (3 * m.E * I) + L / ((5 / 6) * Gm * A));
    const plate = getShape("plate").model, rp = getResult("plate", "tension", "316l");
    const Kt = rp.seqMax / (rp.force / plate.netSection), KtRef = 2 + (1 - plate.holeRatio) ** 3;
    const gap = (a, b) => {
      const g = (100 * (a - b)) / b;
      return `${g < 0 ? "−" : "+"}${fmt(Math.abs(g), 1)}${T.pct}`;
    };
    const rows = [
      [T.vCant, `${fmt(rc.force, 1)}${NB}N`, `${fmt(Fref, 1)}${NB}N (${T.vCantRef})`, gap(rc.force, Fref)],
      [T.vPlate, fmt(Kt, 2), `${fmt(KtRef, 2)} (${T.vPlateRef})`, gap(Kt, KtRef)],
    ];
    body.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      r.forEach((v, i) => {
        const cell = document.createElement(i === 0 ? "th" : "td");
        if (i === 0) { cell.scope = "row"; cell.innerHTML = v; } else cell.textContent = v;
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    }
  }

  // ---------- Start ----------
  syncLoads();
  try { configure(); }
  catch (err) { $("lab-hint").textContent = T.failed; console.error(err); return; }
  lastW = canvas.clientWidth;
  (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => { try { verify(); } catch (err) { console.error(err); } });
})();
