// Finite elements for the simulator page: 2D plane stress, linear elasticity,
// four-node quadrilaterals with incompatible modes (QM6), banded Cholesky solver.
// Pure functions, usable in the browser (window.FE) and in Node (module.exports).
// Units: mm, N, MPa.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Element: QM6 plane-stress quadrilateral ----------

  const G = 1 / Math.sqrt(3);
  const GAUSS = [[-G, -G], [G, -G], [G, G], [-G, G]]; // same order as the corner nodes

  // Extrapolation from the 2x2 Gauss points to the four corners
  const EA = 1 + Math.sqrt(3) / 2, EB = -0.5, EC = 1 - Math.sqrt(3) / 2;
  const EXTRAP = [
    [EA, EB, EC, EB],
    [EB, EA, EB, EC],
    [EC, EB, EA, EB],
    [EB, EC, EB, EA],
  ];

  function dMatrix(E, nu) {
    const c = E / (1 - nu * nu);
    return [c, c * nu, 0, c * nu, c, 0, 0, 0, (c * (1 - nu)) / 2];
  }

  function derivs(xi, eta) {
    return [
      [-(1 - eta) / 4, (1 - eta) / 4, (1 + eta) / 4, -(1 + eta) / 4],
      [-(1 - xi) / 4, -(1 + xi) / 4, (1 + xi) / 4, (1 - xi) / 4],
    ];
  }

  // J = [[dx/dxi, dy/dxi], [dx/deta, dy/deta]]; returns det and the inverse entries
  function jacobian(xs, ys, dxi, deta) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let i = 0; i < 4; i++) {
      a += dxi[i] * xs[i]; b += dxi[i] * ys[i];
      c += deta[i] * xs[i]; d += deta[i] * ys[i];
    }
    const det = a * d - b * c;
    return { det, i11: d / det, i12: -b / det, i21: -c / det, i22: a / det };
  }

  // Bu: 3x8 (nodal dofs u1 v1 ... u4 v4); Ba: 3x4 (incompatible modes, Taylor's QM6 form)
  function bMatrices(xs, ys, xi, eta, J0) {
    const [dxi, deta] = derivs(xi, eta);
    const J = jacobian(xs, ys, dxi, deta);
    const Bu = new Float64Array(24);
    for (let a = 0; a < 4; a++) {
      const nx = J.i11 * dxi[a] + J.i12 * deta[a];
      const ny = J.i21 * dxi[a] + J.i22 * deta[a];
      Bu[2 * a] = nx;
      Bu[8 + 2 * a + 1] = ny;
      Bu[16 + 2 * a] = ny;
      Bu[16 + 2 * a + 1] = nx;
    }
    // modes P1 = 1 - xi^2, P2 = 1 - eta^2, derivatives taken with the centre Jacobian
    const s = J0.det / J.det;
    const p1x = s * J0.i11 * (-2 * xi), p1y = s * J0.i21 * (-2 * xi);
    const p2x = s * J0.i12 * (-2 * eta), p2y = s * J0.i22 * (-2 * eta);
    const Ba = new Float64Array(12);
    Ba[0] = p1x; Ba[1] = p2x;
    Ba[6] = p1y; Ba[7] = p2y;
    Ba[8] = p1y; Ba[9] = p2y; Ba[10] = p1x; Ba[11] = p2x;
    return { Bu, Ba, det: J.det };
  }

  function inverse4(M) {
    const a = Array.from(M), inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let c = 0; c < 4; c++) {
      let p = c;
      for (let r = c + 1; r < 4; r++) if (Math.abs(a[r * 4 + c]) > Math.abs(a[p * 4 + c])) p = r;
      if (p !== c) for (let k = 0; k < 4; k++) {
        [a[c * 4 + k], a[p * 4 + k]] = [a[p * 4 + k], a[c * 4 + k]];
        [inv[c * 4 + k], inv[p * 4 + k]] = [inv[p * 4 + k], inv[c * 4 + k]];
      }
      const d = a[c * 4 + c];
      for (let k = 0; k < 4; k++) { a[c * 4 + k] /= d; inv[c * 4 + k] /= d; }
      for (let r = 0; r < 4; r++) {
        if (r === c) continue;
        const f = a[r * 4 + c];
        for (let k = 0; k < 4; k++) { a[r * 4 + k] -= f * a[c * 4 + k]; inv[r * 4 + k] -= f * inv[c * 4 + k]; }
      }
    }
    return inv;
  }

  // Condensed 8x8 stiffness K, and T (4x8) giving the internal modes: alpha = T u_e
  function elementStiffness(xs, ys, D, t) {
    const [dx0, de0] = derivs(0, 0);
    const J0 = jacobian(xs, ys, dx0, de0);
    const Kuu = new Float64Array(64), Kua = new Float64Array(32), Kaa = new Float64Array(16);
    const DB = new Float64Array(24), DBa = new Float64Array(12);
    for (const [xi, eta] of GAUSS) {
      const { Bu, Ba, det } = bMatrices(xs, ys, xi, eta, J0);
      if (!(det > 0)) throw new Error("Element with a non-positive Jacobian");
      const w = det * t;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 8; c++) DB[r * 8 + c] = D[r * 3] * Bu[c] + D[r * 3 + 1] * Bu[8 + c] + D[r * 3 + 2] * Bu[16 + c];
        for (let c = 0; c < 4; c++) DBa[r * 4 + c] = D[r * 3] * Ba[c] + D[r * 3 + 1] * Ba[4 + c] + D[r * 3 + 2] * Ba[8 + c];
      }
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) Kuu[i * 8 + j] += w * (Bu[i] * DB[j] + Bu[8 + i] * DB[8 + j] + Bu[16 + i] * DB[16 + j]);
        for (let j = 0; j < 4; j++) Kua[i * 4 + j] += w * (Bu[i] * DBa[j] + Bu[8 + i] * DBa[4 + j] + Bu[16 + i] * DBa[8 + j]);
      }
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
        Kaa[i * 4 + j] += w * (Ba[i] * DBa[j] + Ba[4 + i] * DBa[4 + j] + Ba[8 + i] * DBa[8 + j]);
    }
    const Ai = inverse4(Kaa);
    const T = new Float64Array(32);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += Ai[i * 4 + k] * Kua[j * 4 + k];
      T[i * 8 + j] = -s;
    }
    const K = new Float64Array(64);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      let s = Kuu[i * 8 + j];
      for (let k = 0; k < 4; k++) s += Kua[i * 4 + k] * T[k * 8 + j];
      K[i * 8 + j] = s;
    }
    for (let i = 0; i < 8; i++) for (let j = 0; j < i; j++) { // symmetrise round-off
      const m = 0.5 * (K[i * 8 + j] + K[j * 8 + i]);
      K[i * 8 + j] = m; K[j * 8 + i] = m;
    }
    return { K, T, J0 };
  }

  // Stresses (sxx, syy, sxy) at the four Gauss points of one element
  function elementStresses(xs, ys, D, ue, T, J0) {
    const alpha = new Float64Array(4);
    for (let i = 0; i < 4; i++) { let s = 0; for (let j = 0; j < 8; j++) s += T[i * 8 + j] * ue[j]; alpha[i] = s; }
    const out = new Float64Array(12);
    GAUSS.forEach(([xi, eta], g) => {
      const { Bu, Ba } = bMatrices(xs, ys, xi, eta, J0);
      const e = [0, 0, 0];
      for (let r = 0; r < 3; r++) {
        let s = 0;
        for (let c = 0; c < 8; c++) s += Bu[r * 8 + c] * ue[c];
        for (let c = 0; c < 4; c++) s += Ba[r * 4 + c] * alpha[c];
        e[r] = s;
      }
      for (let r = 0; r < 3; r++) out[g * 3 + r] = D[r * 3] * e[0] + D[r * 3 + 1] * e[1] + D[r * 3 + 2] * e[2];
    });
    return out;
  }

  const vonMises = (sxx, syy, sxy) => Math.sqrt(Math.max(0, sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy));

  // ---------- Node ordering: reverse Cuthill–McKee, to keep the band narrow ----------

  function rcm(nn, elems) {
    const adj = Array.from({ length: nn }, () => new Set());
    for (let e = 0; e < elems.length; e += 4)
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) adj[elems[e + a]].add(elems[e + b]);
    const deg = adj.map((s) => s.size);
    const nbrs = adj.map((s) => [...s].sort((p, q) => deg[p] - deg[q]));
    const visited = new Uint8Array(nn), order = [];
    const stamp = new Int32Array(nn).fill(-1);
    let pass = 0;
    const lastLevel = (start) => { // breadth-first levels, returns the last one
      pass++;
      let level = [start]; stamp[start] = pass;
      for (;;) {
        const next = [];
        for (const v of level) for (const w of nbrs[v]) if (!visited[w] && stamp[w] !== pass) { stamp[w] = pass; next.push(w); }
        if (!next.length) return level;
        level = next;
      }
    };
    while (order.length < nn) {
      let s = -1;
      for (let i = 0; i < nn; i++) if (!visited[i] && (s < 0 || deg[i] < deg[s])) s = i;
      for (let k = 0; k < 2; k++) { // pseudo-peripheral start node
        const lv = lastLevel(s);
        s = lv.reduce((m, v) => (deg[v] < deg[m] ? v : m), lv[0]);
      }
      const queue = [s]; visited[s] = 1;
      for (let h = 0; h < queue.length; h++) {
        const v = queue[h]; order.push(v);
        for (const w of nbrs[v]) if (!visited[w]) { visited[w] = 1; queue.push(w); }
      }
    }
    return order.reverse(); // order[p] = node at position p
  }

  // ---------- Assembly and solution ----------

  // bc: { dofs: Int32Array, vals: Float64Array } prescribed displacements
  function solve(mesh, E, nu, t, bc) {
    const { x, y, elems } = mesh;
    const nn = x.length, ne = elems.length / 4, ndof = 2 * nn;
    const D = dMatrix(E, nu);
    const els = new Array(ne);
    const xs = [0, 0, 0, 0], ys = [0, 0, 0, 0];
    for (let e = 0; e < ne; e++) {
      for (let a = 0; a < 4; a++) { xs[a] = x[elems[4 * e + a]]; ys[a] = y[elems[4 * e + a]]; }
      els[e] = elementStiffness(xs, ys, D, t);
    }

    const pres = new Float64Array(ndof).fill(NaN);
    for (let i = 0; i < bc.dofs.length; i++) pres[bc.dofs[i]] = bc.vals[i];
    const order = rcm(nn, elems);
    const eq = new Int32Array(ndof).fill(-1);
    let n = 0;
    for (const node of order) for (let c = 0; c < 2; c++) if (Number.isNaN(pres[2 * node + c])) eq[2 * node + c] = n++;

    const dofs = new Int32Array(8);
    let bw = 0;
    for (let e = 0; e < ne; e++) {
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 4; a++) for (let c = 0; c < 2; c++) {
        const k = eq[2 * elems[4 * e + a] + c];
        if (k >= 0) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
      }
      if (hi >= lo) bw = Math.max(bw, hi - lo);
    }

    const B1 = bw + 1;
    const A = new Float64Array(n * B1), f = new Float64Array(n);
    for (let e = 0; e < ne; e++) {
      for (let a = 0; a < 4; a++) { dofs[2 * a] = 2 * elems[4 * e + a]; dofs[2 * a + 1] = dofs[2 * a] + 1; }
      const K = els[e].K;
      for (let i = 0; i < 8; i++) {
        const I = eq[dofs[i]];
        if (I < 0) continue;
        for (let j = 0; j < 8; j++) {
          const J = eq[dofs[j]];
          if (J < 0) f[I] -= K[i * 8 + j] * pres[dofs[j]];
          else if (J <= I) A[I * B1 + (I - J)] += K[i * 8 + j];
        }
      }
    }

    // banded Cholesky, A = L L^T, stored in place (row i, offset i - j)
    for (let j = 0; j < n; j++) {
      const r0 = Math.max(0, j - bw);
      let s = A[j * B1];
      for (let k = r0; k < j; k++) { const l = A[j * B1 + (j - k)]; s -= l * l; }
      if (!(s > 0)) throw new Error("Stiffness matrix is not positive definite (check the supports)");
      const djj = Math.sqrt(s);
      A[j * B1] = djj;
      const iMax = Math.min(n - 1, j + bw);
      for (let i = j + 1; i <= iMax; i++) {
        const k0 = Math.max(0, i - bw);
        let v = A[i * B1 + (i - j)];
        for (let k = k0; k < j; k++) v -= A[i * B1 + (i - k)] * A[j * B1 + (j - k)];
        A[i * B1 + (i - j)] = v / djj;
      }
    }
    for (let i = 0; i < n; i++) { // L z = f
      let s = f[i];
      for (let k = Math.max(0, i - bw); k < i; k++) s -= A[i * B1 + (i - k)] * f[k];
      f[i] = s / A[i * B1];
    }
    for (let i = n - 1; i >= 0; i--) { // L^T u = z
      let s = f[i];
      const kMax = Math.min(n - 1, i + bw);
      for (let k = i + 1; k <= kMax; k++) s -= A[k * B1 + (k - i)] * f[k];
      f[i] = s / A[i * B1];
    }

    const u = new Float64Array(ndof);
    for (let d = 0; d < ndof; d++) u[d] = eq[d] >= 0 ? f[eq[d]] : pres[d];

    // nodal forces r = K u (reactions at the prescribed dofs) and nodal-averaged stresses
    const r = new Float64Array(ndof);
    const sxx = new Float64Array(nn), syy = new Float64Array(nn), sxy = new Float64Array(nn), cnt = new Float64Array(nn);
    const ue = new Float64Array(8);
    for (let e = 0; e < ne; e++) {
      for (let a = 0; a < 4; a++) {
        const nd = elems[4 * e + a];
        xs[a] = x[nd]; ys[a] = y[nd];
        ue[2 * a] = u[2 * nd]; ue[2 * a + 1] = u[2 * nd + 1];
      }
      const K = els[e].K;
      for (let i = 0; i < 8; i++) {
        let s = 0;
        for (let j = 0; j < 8; j++) s += K[i * 8 + j] * ue[j];
        r[2 * elems[4 * e + (i >> 1)] + (i & 1)] += s;
      }
      const sg = elementStresses(xs, ys, D, ue, els[e].T, els[e].J0);
      for (let a = 0; a < 4; a++) {
        const nd = elems[4 * e + a];
        let v0 = 0, v1 = 0, v2 = 0;
        for (let g = 0; g < 4; g++) { const w = EXTRAP[a][g]; v0 += w * sg[3 * g]; v1 += w * sg[3 * g + 1]; v2 += w * sg[3 * g + 2]; }
        sxx[nd] += v0; syy[nd] += v1; sxy[nd] += v2; cnt[nd]++;
      }
    }
    const seq = new Float64Array(nn);
    for (let i = 0; i < nn; i++) {
      if (cnt[i]) { sxx[i] /= cnt[i]; syy[i] /= cnt[i]; sxy[i] /= cnt[i]; }
      seq[i] = vonMises(sxx[i], syy[i], sxy[i]);
    }
    return { u, r, sxx, syy, sxy, seq, equations: n, bandwidth: bw };
  }

  // ---------- Meshes ----------

  const uniform = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  // n elements from a to b, each one `ratio` times longer than the previous
  const graded = (a, b, n, ratio) => {
    const h0 = ratio === 1 ? (b - a) / n : ((b - a) * (ratio - 1)) / (Math.pow(ratio, n) - 1);
    const p = [a];
    for (let i = 0, h = h0; i < n; i++, h *= ratio) p.push(p[i] + h);
    p[n] = b;
    return p;
  };
  const join = (...parts) => parts.reduce((acc, p) => (acc.length ? acc.concat(p.slice(1)) : p.slice()), []);
  const mirror = (half) => half.slice(1).reverse().map((v) => -v).concat(half);

  // Columns at xs; in each column the rows span [-h(x), h(x)] uniformly
  function mappedMesh(xs, h, ny) {
    const nx = xs.length - 1, nn = (nx + 1) * (ny + 1);
    const x = new Float64Array(nn), y = new Float64Array(nn);
    for (let i = 0; i <= nx; i++) {
      const hh = h(xs[i]);
      for (let j = 0; j <= ny; j++) { const id = i * (ny + 1) + j; x[id] = xs[i]; y[id] = -hh + (2 * hh * j) / ny; }
    }
    const elems = new Int32Array(4 * nx * ny);
    let k = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const n1 = i * (ny + 1) + j, n2 = (i + 1) * (ny + 1) + j;
      elems[k++] = n1; elems[k++] = n2; elems[k++] = n2 + 1; elems[k++] = n1 + 1;
    }
    return { x, y, elems };
  }

  // Flat tensile specimen with shouldered grips (dog-bone); 20 mm transition radius
  function dogbone() {
    const Wp = 3, Wg = 5, Lp = 32, R = 20, Lg = 30, jaw = 20;
    const a = Math.sqrt(R * R - (R - (Wg - Wp)) ** 2);
    const Lh = Lp / 2 + a + Lg;
    const h = (x) => {
      const s = Math.abs(x);
      if (s <= Lp / 2) return Wp;
      if (s <= Lp / 2 + a) { const q = s - Lp / 2; return Wp + R - Math.sqrt(R * R - q * q); }
      return Wg;
    };
    const half = join(uniform(0, Lp / 2, 20), uniform(Lp / 2, Lp / 2 + a, 12), graded(Lp / 2 + a, Lh, 14, 1.12));
    return {
      mesh: mappedMesh(mirror(half), h, 10),
      thickness: 2,
      fixedRect: [-Lh - 1, -Lh + jaw, -Wg - 2, Wg + 2],
      movingRect: [Lh - jaw, Lh + 1, -Wg - 2, Wg + 2],
      loads: ["tension", "compression"],
    };
  }

  // Plate with a central hole: O-grid around the hole plus two end blocks
  function plateWithHole() {
    const H = 20, rh = 5, Lext = 40, m = 16, nr = 16, q = 1.15, nxe = 12, jaw = 15;
    const nt = 4 * m;
    const outer = (k) => {
      const s = Math.floor(k / m), f = (k % m) / m;
      if (s === 0) return [H, -H + 2 * H * f];
      if (s === 1) return [H - 2 * H * f, H];
      if (s === 2) return [-H, H - 2 * H * f];
      return [-H + 2 * H * f, -H];
    };
    const g = (i) => (Math.pow(q, i) - 1) / (Math.pow(q, nr) - 1);
    const x = [], y = [], el = [];
    const ring = (i, k) => i * nt + (((k % nt) + nt) % nt);
    for (let i = 0; i <= nr; i++) for (let k = 0; k < nt; k++) {
      const th = -Math.PI / 4 + (2 * Math.PI * k) / nt;
      const [ox, oy] = outer(k), hx = rh * Math.cos(th), hy = rh * Math.sin(th), w = g(i);
      x.push(hx + w * (ox - hx)); y.push(hy + w * (oy - hy));
    }
    for (let i = 0; i < nr; i++) for (let k = 0; k < nt; k++)
      el.push(ring(i, k), ring(i + 1, k), ring(i + 1, k + 1), ring(i, k + 1));
    // end blocks: rows at the square's edge nodes, j = 0..m bottom to top
    const block = (x0, x1, shared, sharedCol) => {
      const cols = uniform(x0, x1, nxe), ids = [];
      for (let c = 0; c <= nxe; c++) {
        ids.push([]);
        for (let j = 0; j <= m; j++) {
          if (c === sharedCol) { ids[c].push(shared(j)); continue; }
          ids[c].push(x.length); x.push(cols[c]); y.push(-H + (2 * H * j) / m);
        }
      }
      for (let c = 0; c < nxe; c++) for (let j = 0; j < m; j++)
        el.push(ids[c][j], ids[c + 1][j], ids[c + 1][j + 1], ids[c][j + 1]);
    };
    block(H, H + Lext, (j) => ring(nr, j), 0);
    block(-H - Lext, -H, (j) => ring(nr, 3 * m - j), nxe);
    const Lh = H + Lext;
    return {
      mesh: { x: Float64Array.from(x), y: Float64Array.from(y), elems: Int32Array.from(el) },
      thickness: 2,
      fixedRect: [-Lh - 1, -Lh + jaw, -H - 2, H + 2],
      movingRect: [Lh - jaw, Lh + 1, -H - 2, H + 2],
      loads: ["tension", "compression"],
      netSection: 2 * (H - rh) * 2,
      holeRatio: (2 * rh) / (2 * H),
    };
  }

  // Bar with two opposite circular-arc notches
  function notchedBar() {
    const Hh = 10, r = 5, depth = 3, Lh = 50, jaw = 15;
    const yc = Hh - depth + r, a = Math.sqrt(r * r - (r - depth) ** 2);
    const h = (x) => (Math.abs(x) < a ? yc - Math.sqrt(r * r - x * x) : Hh);
    const half = join(uniform(0, a, 18), graded(a, Lh, 18, 1.13));
    return {
      mesh: mappedMesh(mirror(half), h, 16),
      thickness: 2,
      fixedRect: [-Lh - 1, -Lh + jaw, -Hh - 2, Hh + 2],
      movingRect: [Lh - jaw, Lh + 1, -Hh - 2, Hh + 2],
      loads: ["tension", "compression", "bending"],
    };
  }

  // Cantilever: clamped on the left edge, loaded on the right edge
  function cantilever() {
    const L = 100, Hh = 5;
    const mesh = mappedMesh(uniform(0, L, 80), () => Hh, 8);
    return {
      mesh,
      thickness: 10,
      fixedRect: [-1, 0, -Hh - 1, Hh + 1],
      movingRect: [L, L + 1, -Hh - 1, Hh + 1],
      wall: true,
      loads: ["bending"],
      beam: { L, H: 2 * Hh, t: 10 },
    };
  }

  const SHAPES = { dogbone, plate: plateWithHole, notched: notchedBar, cantilever };

  // Loads, each for a unit imposed displacement d = 1 mm along `dir`.
  // Axial loads move the whole jaw (both components imposed, like a clamping grip);
  // bending moves the free end vertically and leaves it free to rotate.
  const LOADS = {
    tension: { dir: [1, 0], edge: false },
    compression: { dir: [-1, 0], edge: false },
    bending: { dir: [0, -1], edge: true },
  };

  function boundary(model, loadId) {
    const { x, y } = model.mesh, nn = x.length, load = LOADS[loadId];
    const tol = 1e-9;
    const inRect = (i, R) => x[i] >= R[0] - tol && x[i] <= R[1] + tol && y[i] >= R[2] - tol && y[i] <= R[3] + tol;
    let xmax = -Infinity;
    for (let i = 0; i < nn; i++) xmax = Math.max(xmax, x[i]);
    const fixed = [], moving = [], dofs = [], vals = [];
    for (let i = 0; i < nn; i++) {
      if (inRect(i, model.fixedRect)) { fixed.push(i); dofs.push(2 * i, 2 * i + 1); vals.push(0, 0); }
      else if (load.edge ? Math.abs(x[i] - xmax) < tol : inRect(i, model.movingRect)) {
        moving.push(i);
        if (load.edge) { dofs.push(2 * i + 1); vals.push(load.dir[1]); }
        else { dofs.push(2 * i, 2 * i + 1); vals.push(load.dir[0], load.dir[1]); }
      }
    }
    return { dofs: Int32Array.from(dofs), vals: Float64Array.from(vals), fixed, moving, dir: load.dir, edge: load.edge };
  }

  // Solve one configuration for a unit imposed displacement; everything else scales linearly with d
  function analyse(model, loadId, E, nu) {
    const bc = boundary(model, loadId);
    const res = solve(model.mesh, E, nu, model.thickness, bc);
    let F = 0;
    for (const i of bc.moving) F += res.r[2 * i] * bc.dir[0] + res.r[2 * i + 1] * bc.dir[1];
    let imax = 0;
    for (let i = 1; i < res.seq.length; i++) if (res.seq[i] > res.seq[imax]) imax = i;
    let umax = 0;
    for (let i = 0; i < res.seq.length; i++) umax = Math.max(umax, Math.hypot(res.u[2 * i], res.u[2 * i + 1]));
    return { ...res, bc, force: F, seqMax: res.seq[imax], seqMaxNode: imax, umax };
  }

  return { SHAPES, LOADS, dMatrix, elementStiffness, solve, boundary, analyse, mappedMesh, uniform, vonMises };
});
