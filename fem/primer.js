// FEM primer: equation rendering, contents highlighting and the three figures.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const clear = (svg) => { while (svg.firstChild) svg.removeChild(svg.firstChild); };
  const fmt = (x, d = 1) => x.toFixed(d); // SVG coordinates, always with a dot

  // ---------- Language: figure text and number formats follow the page ----------
  const LANG = (document.documentElement.lang || "en").slice(0, 2) === "fr" ? "fr" : "en";
  const T = {
    en: {
      fixed: "fixed", free: "free",
      uTitle: "Displacement, u / u(L)", nTitle: "Axial force, N / N(0)",
      xLabel: "Position along the bar, x / L",
      exact: "Exact", fe: "Finite elements",
      ofPeak: (v) => `${v}% of peak`,
      nrX: "Displacement, u", nrY: "Internal force, f_int(u)", nrLoad: "Applied load, f_ext",
      iteration: "Iteration", residual: "Residual, |R|",
    },
    fr: {
      fixed: "encastré", free: "libre",
      uTitle: "Déplacement, u / u(L)", nTitle: "Effort normal, N / N(0)",
      xLabel: "Position le long de la barre, x / L",
      exact: "Solution exacte", fe: "Éléments finis",
      ofPeak: (v) => `${v}\u202F% du maximum`,
      nrX: "Déplacement, u", nrY: "Effort interne, f_int(u)", nrLoad: "Chargement imposé, f_ext",
      iteration: "Itération", residual: "Résidu, |R|",
    },
  }[LANG];
  const num = (x, d) => new Intl.NumberFormat(LANG, { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  const int = (x) => new Intl.NumberFormat(LANG).format(x);

  // ---------- Equations ----------
  if (window.renderMathInElement) {
    renderMathInElement(document.querySelector(".primer__body"), {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  }

  // ---------- Contents: highlight the section being read ----------
  const links = [...document.querySelectorAll(".toc a")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
  let ticking = false;
  const markActive = () => {
    ticking = false;
    const y = window.innerHeight * 0.3;
    let active = 0;
    sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= y) active = i; });
    links.forEach((a, i) => a.classList.toggle("is-active", i === active));
  };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(markActive); } }, { passive: true });
  markActive();

  // ---------- Fig. 1: plate with a hole, continuous and meshed ----------
  (() => {
    const body = document.getElementById("mesh-body");
    const grid = document.getElementById("mesh-grid");
    const slider = document.getElementById("mesh-density");
    if (!body || !grid || !slider) return;

    const C = 150, H = 122, A = 0.34 * H; // centre, half-size, hole radius

    const plate = (svg) => {
      el("rect", { x: C - H, y: C - H, width: 2 * H, height: 2 * H, class: "svg-fill" }, svg);
      el("circle", { cx: C, cy: C, r: A, class: "svg-hole" }, svg);
    };
    const outline = (svg) => {
      el("rect", { x: C - H, y: C - H, width: 2 * H, height: 2 * H, class: "svg-ink", "stroke-width": 1.6 }, svg);
      el("circle", { cx: C, cy: C, r: A, class: "svg-ink", "stroke-width": 1.6 }, svg);
    };
    const arrows = (svg) => {
      // uniform tension on the left and right edges
      const g = el("g", { class: "svg-muted", "stroke-width": 1.3 }, svg);
      for (let k = -2; k <= 2; k++) {
        const y = C + k * (H / 2.6);
        for (const side of [-1, 1]) {
          const x0 = C + side * (H + 4), x1 = C + side * (H + 22);
          el("line", { x1: x0, y1: y, x2: x1, y2: y }, g);
          el("path", { d: `M${x1 - side * 5},${y - 3.5} L${x1},${y} L${x1 - side * 5},${y + 3.5}` }, g);
        }
      }
    };

    plate(body); outline(body); arrows(body);

    const draw = () => {
      const nt = +slider.value;                  // elements around the hole
      const nr = Math.max(2, Math.round(nt / 4)); // elements from hole to edge
      const node = (i, j) => {
        const th = Math.PI / 4 + (2 * Math.PI * j) / nt;
        const c = Math.cos(th), s = Math.sin(th);
        const R = H / Math.max(Math.abs(c), Math.abs(s));
        const t = Math.pow(i / nr, 1.35); // grade towards the hole
        const r = A + t * (R - A);
        return [C + r * c, C - r * s];
      };

      clear(grid);
      plate(grid);

      // highlight one element and its four nodes
      const hi = [1, Math.round(nt / 8)];
      const q = [node(hi[0], hi[1]), node(hi[0] + 1, hi[1]), node(hi[0] + 1, hi[1] + 1), node(hi[0], hi[1] + 1)];
      el("path", { d: `M${q.map((p) => p.join(",")).join("L")}Z`, class: "svg-fill-strong" }, grid);

      let d = "";
      for (let i = 0; i <= nr; i++) {        // rings
        for (let j = 0; j <= nt; j++) {
          const [x, y] = node(i, j % nt);
          d += (j === 0 ? "M" : "L") + fmt(x, 2) + "," + fmt(y, 2);
        }
      }
      for (let j = 0; j < nt; j++) {         // rays
        const [x0, y0] = node(0, j), [x1, y1] = node(nr, j);
        d += `M${fmt(x0, 2)},${fmt(y0, 2)}L${fmt(x1, 2)},${fmt(y1, 2)}`;
      }
      el("path", { d, class: "svg-ink", "stroke-width": nt > 32 ? 0.55 : 0.8 }, grid);
      outline(grid);
      q.forEach(([x, y]) => el("circle", { cx: x, cy: y, r: 3.4, class: "svg-dot-accent" }, grid));

      const elems = nt * nr, nodes = nt * (nr + 1);
      document.getElementById("mesh-elems").textContent = int(elems);
      document.getElementById("mesh-nodes").textContent = int(nodes);
      document.getElementById("mesh-dofs").textContent = int(2 * nodes);
    };
    slider.addEventListener("input", draw);
    draw();
  })();

  // ---------- Fig. 2: hanging bar, exact against finite elements ----------
  (() => {
    const svg = document.getElementById("bar-plot");
    const slider = document.getElementById("bar-n");
    if (!svg || !slider) return;

    const X0 = 70, X1 = 610;
    const xs = (xi) => X0 + xi * (X1 - X0);
    const plots = [
      { top: 118, bottom: 268, title: T.uTitle, exact: (s) => 2 * s - s * s },
      { top: 318, bottom: 438, title: T.nTitle, exact: (s) => 1 - s },
    ];

    const draw = () => {
      const n = +slider.value;
      clear(svg);

      // the bar: wall, elements, nodes, distributed load
      const by = 50, bh = 16;
      el("line", { x1: X0 - 6, y1: by - 26, x2: X0 - 6, y2: by + 26, class: "svg-ink", "stroke-width": 2 }, svg);
      for (let k = 0; k < 7; k++) {
        const y = by - 24 + k * 8;
        el("line", { x1: X0 - 6, y1: y, x2: X0 - 16, y2: y + 8, class: "svg-muted", "stroke-width": 1 }, svg);
      }
      el("rect", { x: X0, y: by - bh / 2, width: X1 - X0, height: bh, class: "svg-fill" }, svg);
      el("rect", { x: X0, y: by - bh / 2, width: X1 - X0, height: bh, class: "svg-ink", "stroke-width": 1.4 }, svg);
      for (let i = 1; i < n; i++) {
        const x = xs(i / n);
        el("line", { x1: x, y1: by - bh / 2, x2: x, y2: by + bh / 2, class: "svg-ink", "stroke-width": 1.2 }, svg);
      }
      for (let i = 0; i <= n; i++) el("circle", { cx: xs(i / n), cy: by, r: 3.6, class: "svg-dot-accent" }, svg);
      const lg = el("g", { class: "svg-muted", "stroke-width": 1.1 }, svg);
      for (let x = X0 + 16; x < X1 - 6; x += 36) {
        el("line", { x1: x, y1: by - 18, x2: x + 18, y2: by - 18 }, lg);
        el("path", { d: `M${x + 14},${by - 21} L${x + 18},${by - 18} L${x + 14},${by - 15}` }, lg);
      }
      el("text", { x: X1 + 6, y: by - 14, class: "svg-text" }, svg).textContent = "q";
      el("text", { x: X0, y: by + 30, class: "svg-text" }, svg).textContent = T.fixed;
      el("text", { x: X1, y: by + 30, class: "svg-text", "text-anchor": "end" }, svg).textContent = T.free;

      plots.forEach((p, k) => {
        const ys = (v) => p.bottom - v * (p.bottom - p.top);
        // axes and grid
        el("line", { x1: X0, y1: p.bottom, x2: X1, y2: p.bottom, class: "svg-muted", "stroke-width": 1 }, svg);
        el("line", { x1: X0, y1: p.top, x2: X0, y2: p.bottom, class: "svg-muted", "stroke-width": 1 }, svg);
        el("line", { x1: X0, y1: ys(1), x2: X1, y2: ys(1), class: "svg-rule", "stroke-width": 1, "stroke-dasharray": "3 4" }, svg);
        el("text", { x: X0 - 10, y: ys(1) + 4, class: "svg-text", "text-anchor": "end" }, svg).textContent = "1";
        el("text", { x: X0 - 10, y: p.bottom + 4, class: "svg-text", "text-anchor": "end" }, svg).textContent = "0";
        el("text", { x: X0, y: p.top - 12, class: "svg-text-ink" }, svg).textContent = p.title;

        // exact solution
        let d = "";
        for (let i = 0; i <= 120; i++) {
          const s = i / 120;
          d += (i ? "L" : "M") + fmt(xs(s), 2) + "," + fmt(ys(p.exact(s)), 2);
        }
        el("path", { d, class: "svg-exact", "stroke-width": 2.4 }, svg);

        // finite element solution
        d = "";
        if (k === 0) {
          for (let i = 0; i <= n; i++) {
            const s = i / n;
            d += (i ? "L" : "M") + fmt(xs(s), 2) + "," + fmt(ys(p.exact(s)), 2);
          }
          el("path", { d, class: "svg-ink", "stroke-width": 1.8 }, svg);
          for (let i = 0; i <= n; i++) el("circle", { cx: xs(i / n), cy: ys(p.exact(i / n)), r: 3.4, class: "svg-dot" }, svg);
        } else {
          for (let i = 0; i < n; i++) {
            const v = p.exact((i + 0.5) / n); // constant per element, equal to the exact midpoint value
            d += (i ? "L" : "M") + fmt(xs(i / n), 2) + "," + fmt(ys(v), 2) + "L" + fmt(xs((i + 1) / n), 2) + "," + fmt(ys(v), 2);
          }
          el("path", { d, class: "svg-ink", "stroke-width": 1.8 }, svg);
        }
      });

      // x axis labels and legend
      const b = plots[1].bottom;
      [[num(0, 0), 0], [num(0.5, 1), 0.5], [num(1, 0), 1]].forEach(([t, s]) =>
        el("text", { x: xs(s), y: b + 18, class: "svg-text", "text-anchor": "middle" }, svg).textContent = t);
      el("text", { x: X1, y: b + 34, class: "svg-text", "text-anchor": "end" }, svg).textContent = T.xLabel;

      // legend, laid out right to left from the measured text widths
      const ly = plots[0].top - 16;
      const legend = [[T.fe, "svg-ink", 1.8], [T.exact, "svg-exact", 2.4]];
      let right = X1;
      legend.forEach(([label, cls, w]) => {
        const t = el("text", { x: 0, y: ly + 4, class: "svg-text" }, svg);
        t.textContent = label;
        const tw = t.getComputedTextLength();
        t.setAttribute("x", right - tw);
        el("line", { x1: right - tw - 30, y1: ly, x2: right - tw - 6, y2: ly, class: cls, "stroke-width": w }, svg);
        right -= tw + 30 + 22;
      });

      document.getElementById("bar-count").textContent = String(n);
      document.getElementById("bar-err").textContent = T.ofPeak(num(100 / (2 * n), 1));
    };
    slider.addEventListener("input", draw);
    draw();
  })();

  // ---------- Fig. 3: Newton–Raphson on a softening response ----------
  (() => {
    const svg = document.getElementById("nr-plot");
    const next = document.getElementById("nr-step");
    const reset = document.getElementById("nr-reset");
    const readout = document.getElementById("nr-readout");
    if (!svg || !next || !reset || !readout) return;

    const F = (u) => Math.tanh(u) + 0.08 * u;               // internal force
    const KT = (u) => 1 - Math.tanh(u) ** 2 + 0.08;         // tangent stiffness
    const FEXT = 0.9, MAXIT = 4;
    const us = [0];
    for (let k = 0; k < MAXIT; k++) us.push(us[k] + (FEXT - F(us[k])) / KT(us[k]));

    const X0 = 70, X1 = 610, Y0 = 318, Y1 = 28, UMAX = 1.6, FMAX = 1.1;
    const xs = (u) => X0 + (u / UMAX) * (X1 - X0);
    const ys = (f) => Y0 - (f / FMAX) * (Y0 - Y1);
    let k = 0;

    const draw = () => {
      clear(svg);
      el("line", { x1: X0, y1: Y0, x2: X1, y2: Y0, class: "svg-muted", "stroke-width": 1 }, svg);
      el("line", { x1: X0, y1: Y1, x2: X0, y2: Y0, class: "svg-muted", "stroke-width": 1 }, svg);
      el("text", { x: X1, y: Y0 + 34, class: "svg-text", "text-anchor": "end" }, svg).textContent = T.nrX;
      el("text", { x: X0 + 8, y: Y1 + 4, class: "svg-text" }, svg).textContent = T.nrY;

      el("line", { x1: X0, y1: ys(FEXT), x2: X1, y2: ys(FEXT), class: "svg-muted", "stroke-width": 1.2, "stroke-dasharray": "5 5" }, svg);
      el("text", { x: X0 + 8, y: ys(FEXT) - 8, class: "svg-text" }, svg).textContent = T.nrLoad;

      let d = "";
      for (let i = 0; i <= 160; i++) {
        const u = (i / 160) * UMAX;
        d += (i ? "L" : "M") + fmt(xs(u), 2) + "," + fmt(ys(F(u)), 2);
      }
      el("path", { d, class: "svg-ink", "stroke-width": 2 }, svg);

      for (let i = 0; i < k; i++) {
        const u0 = us[i], u1 = us[i + 1];
        el("line", { x1: xs(u0), y1: ys(F(u0)), x2: xs(u1), y2: ys(FEXT), class: "svg-exact", "stroke-width": 1.8 }, svg);
        el("line", { x1: xs(u1), y1: ys(FEXT), x2: xs(u1), y2: ys(F(u1)), class: "svg-muted", "stroke-width": 1.1, "stroke-dasharray": "3 3" }, svg);
      }
      for (let i = 0; i <= k; i++) {
        el("circle", { cx: xs(us[i]), cy: ys(F(us[i])), r: 4, class: i === k ? "svg-dot-accent" : "svg-dot" }, svg);
        if (i < 3) {
          const t = el("text", { x: xs(us[i]) + (i === 0 ? 8 : -8), y: ys(F(us[i])) + 18, class: "svg-text", "text-anchor": i === 0 ? "start" : "end" }, svg);
          t.textContent = `u${"₀₁₂"[i]}`;
        }
      }

      const R = Math.abs(FEXT - F(us[k]));
      readout.innerHTML = "";
      const rTxt = R < 1e-4 ? (LANG === "fr" ? R.toExponential(1).replace(".", ",") : R.toExponential(1)) : num(R, 4);
      [[T.iteration, String(k)], [T.residual, rTxt]].forEach(([t, v]) => {
        const div = document.createElement("div");
        const dt = document.createElement("dt"); dt.textContent = t;
        const dd = document.createElement("dd"); dd.textContent = v;
        div.append(dt, dd); readout.append(div);
      });
      next.disabled = k >= MAXIT;
    };
    next.addEventListener("click", () => { if (k < MAXIT) { k++; draw(); } });
    reset.addEventListener("click", () => { k = 0; draw(); });
    draw();
  })();
})();
