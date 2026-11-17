// Baseline: the usual "clip the triangles and call it a cut" approach.
// It keeps every clipped fragment but never builds a cap, so the result is an open
// surface with a boundary ring. Self-contained on purpose (no import from src/core.mjs).
export function naiveClip(mesh, plane) {
  const P = mesh.positions, I = mesh.indices;
  let nl = Math.hypot(plane.n[0], plane.n[1], plane.n[2]);
  const n = [plane.n[0] / nl, plane.n[1] / nl, plane.n[2] / nl];
  const d = plane.d / nl;
  const sd = [];
  for (let i = 0; i < P.length; i += 3) sd.push(n[0] * P[i] + n[1] * P[i + 1] + n[2] * P[i + 2] - d);
  const sides = [[], []], positions = P.slice();
  const onPlane = (v) => Math.abs(sd[v]) < 1e-12;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    for (let s = 0; s < 2; s++) {
      const dir = s === 1 ? 1 : -1;
      const keep = (v) => dir * sd[v] >= 0;
      const out = [];
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3];
        if (keep(a)) out.push(a);
        if (keep(a) !== keep(b)) {
          const f = sd[a] / (sd[a] - sd[b]);
          const id = positions.length / 3;
          positions.push(P[3 * a] + f * (P[3 * b] - P[3 * a]),
                         P[3 * a + 1] + f * (P[3 * b + 1] - P[3 * a + 1]),
                         P[3 * a + 2] + f * (P[3 * b + 2] - P[3 * a + 2]));
          out.push(id);
        }
      }
      const clean = out.filter((v, i) => v !== out[(i + out.length - 1) % out.length]);
      for (let i = 1; i + 1 < clean.length; i++) sides[s].push(clean[0], clean[i], clean[i + 1]);
    }
  }
  const pieces = sides.map((idx) => {
    const remap = new Map(), pp = [], ii = [];
    for (const g of idx) {
      if (!remap.has(g)) { remap.set(g, pp.length / 3); pp.push(positions[3 * g], positions[3 * g + 1], positions[3 * g + 2]); }
      ii.push(remap.get(g));
    }
    const edges = new Map();
    for (let t = 0; t < ii.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = ii[t + k], b = ii[t + (k + 1) % 3];
      const key = a < b ? a + '_' + b : b + '_' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    let boundary = 0;
    for (const c of edges.values()) if (c === 1) boundary++;
    return { positions: pp, indices: ii, boundaryEdges: boundary };
  });
  return { pieces, boundaryEdges: pieces[0].boundaryEdges + pieces[1].boundaryEdges };
}