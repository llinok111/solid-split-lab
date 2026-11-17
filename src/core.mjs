// solid-split core: pure computational geometry. No three.js, no DOM, no I/O.
// A "mesh" is {positions: number[] flat xyz, indices: number[] flat triangle ids}.
// A "plane" is {n: [x,y,z], d: number}; signed distance of p is dot(n,p) - d.

export function bbox(positions) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  return { lo, hi };
}

export function bboxDiag(positions) {
  const { lo, hi } = bbox(positions);
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

export function triArea(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

// Signed volume of a closed, outward-wound triangle soup (divergence theorem).
export function signedVolume(positions, indices) {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

// Manifold audit. A closed solid: every undirected edge used exactly twice and the
// two uses traverse it in opposite directions (consistent outward winding).
export function auditMesh(mesh) {
  const pos = mesh.positions, idx = mesh.indices;
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = a < b ? a + '_' + b : b + '_' + a;
      const e = edges.get(key) || { count: 0, orient: 0 };
      e.count++;
      e.orient += a < b ? 1 : -1;   // opposite traversal cancels
      edges.set(key, e);
    }
  }
  let boundary = 0, nonManifold = 0, flipped = 0, degenerate = 0;
  for (const e of edges.values()) {
    if (e.count === 1) boundary++;
    else if (e.count > 2) nonManifold++;
    else if (e.orient !== 0) flipped++;
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    if (a === b || b === c || a === c) degenerate++;
    else if (triArea([pos[a], pos[a + 1], pos[a + 2]], [pos[b], pos[b + 1], pos[b + 2]],
                     [pos[c], pos[c + 1], pos[c + 2]]) === 0) degenerate++;
  }
  return {
    triangles: idx.length / 3, edges: edges.size, boundaryEdges: boundary,
    nonManifoldEdges: nonManifold, flippedEdges: flipped, degenerateTriangles: degenerate,
    closed: boundary === 0 && nonManifold === 0 && flipped === 0 && degenerate === 0,
  };
}

function dot3(n, p) { return n[0] * p[0] + n[1] * p[1] + n[2] * p[2]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Orthonormal in-plane basis (u, w) with u x w = n, so CCW in (u,w) faces +n.
function planeBasis(n) {
  let ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = cross3(ref, n);
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w = cross3(n, u);
  const origin = [0, 0, 0]; // projection is translation-invariant for area/shape
  return { u, w, origin };
}

function signedArea2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      const x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (x > p[0]) inside = !inside;
    }
  }
  return inside;
}

// Ear clipping for a simple polygon (CCW input). Returns flat triangles of vertex ids.
function earClip(pts2, ids, eps) {
  const out = [];
  let poly = ids.slice();
  let guard = 0;
  while (poly.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < poly.length; i++) {
      const ia = poly[(i + poly.length - 1) % poly.length], ib = poly[i], ic = poly[(i + 1) % poly.length];
      const A = pts2.get(ia), B = pts2.get(ib), C = pts2.get(ic);
      const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (cross <= eps) continue;                  // reflex or degenerate ear
      let contains = false;
      for (const id of poly) {
        if (id === ia || id === ib || id === ic) continue;
        const P = pts2.get(id);
        if (P[0] === A[0] && P[1] === A[1]) { contains = true; break; }
        const d1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
        const d2 = (C[0] - B[0]) * (P[1] - B[1]) - (C[1] - B[1]) * (P[0] - B[0]);
        const d3 = (A[0] - C[0]) * (P[1] - C[1]) - (A[1] - C[1]) * (P[0] - C[0]);
        if (d1 >= -eps && d2 >= -eps && d3 >= -eps) { contains = true; break; }
      }
      if (contains) continue;
      out.push(ia, ib, ic);
      poly.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                            // should not happen on simple polygons
  }
  if (poly.length === 3) out.push(poly[0], poly[1], poly[2]);
  return { triangles: out, remaining: poly.length > 3 ? poly : [] };
}

// Split a closed mesh by a plane into two closed solids with welded caps.
// opts.eps      absolute distance tolerance (default 1e-9 * bbox diagonal) - disclosed
// opts.areaEps  relative sliver cutoff, as a fraction of diag^2 (default 1e-20)
// On any situation the implementation cannot handle it refuses: {ok:false, reason}.
export function splitMesh(mesh, plane, opts = {}) {
  const P = mesh.positions, I = mesh.indices;
  const diag = bboxDiag(P);
  const nRaw = plane.n;
  const nl = Math.hypot(nRaw[0], nRaw[1], nRaw[2]);
  if (!(nl > 0)) return { ok: false, reason: 'degenerate-plane-normal' };
  const n = [nRaw[0] / nl, nRaw[1] / nl, nRaw[2] / nl];
  const d = plane.d / nl;
  const eps = opts.eps ?? 1e-9 * diag;
  const areaEps = (opts.areaEps ?? 1e-20) * diag * diag;

  const nv = P.length / 3;
  const sd = new Float64Array(nv);
  for (let i = 0; i < nv; i++) sd[i] = dot3(n, [P[3 * i], P[3 * i + 1], P[3 * i + 2]]) - d;

  const positions = P.slice();
  const cutPos = new Map();     // "a_b" (a<b) -> new vertex id
  const cutKeys = [];           // parallel: new vertex ids
  const sides = [[], []];       // sides[0] = minus, sides[1] = plus ; flat triangle ids
  const segs = [[], []];        // undirected cut segments per side, global vertex ids
  const edgeSides = new Map();  // on-plane original edges -> which sides use them
  const onPlane = (v) => Math.abs(dot3(n, [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]) - d) <= eps * 8;

  const newCutVertex = (a, b) => {
    const key = a < b ? a + '_' + b : b + '_' + a;
    const hit = cutPos.get(key);
    if (hit !== undefined) return hit;
    const da = sd[a], db = sd[b];
    const t = da / (da - db);
    const id = positions.length / 3;
    positions.push(P[3 * a] + t * (P[3 * b] - P[3 * a]),
                   P[3 * a + 1] + t * (P[3 * b + 1] - P[3 * a + 1]),
                   P[3 * a + 2] + t * (P[3 * b + 2] - P[3 * a + 2]));
    cutPos.set(key, id);
    cutKeys.push(id);
    return id;
  };

  // Clip one triangle to side s (+1 keeps sd >= -eps, -1 keeps sd <= eps).
  // Returns array of {id, cut} for the kept polygon.
  const clipTri = (tri, s) => {
    const keep = (v) => s * sd[v] >= -eps;
    const out = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const ka = keep(a), kb = keep(b);
      if (ka) out.push({ id: a, cut: Math.abs(sd[a]) <= eps });
      if (ka !== kb) {
        // if either endpoint already sits on the plane, reuse it (no duplicate vertex)
        if (Math.abs(sd[b]) <= eps) out.push({ id: b, cut: true });
        else if (Math.abs(sd[a]) <= eps) out.push({ id: a, cut: true });
        else out.push({ id: newCutVertex(a, b), cut: true });
      }
    }
    // drop consecutive duplicates (vertex exactly on the plane)
    const clean = [];
    for (const v of out) {
      if (clean.length && clean[clean.length - 1].id === v.id) continue;
      if (clean.length > 2 && clean[0].id === v.id) continue;
      clean.push(v);
    }
    if (clean.length > 2 && clean[0].id === clean[clean.length - 1].id) clean.pop();
    return clean;
  };

  const polyArea = (poly) => {
    if (poly.length < 3) return 0;
    const a = poly[0].id;
    let area = 0;
    for (let i = 1; i + 1 < poly.length; i++) {
      const b = poly[i].id, c = poly[i + 1].id;
      area += triArea([positions[3 * a], positions[3 * a + 1], positions[3 * a + 2]],
                      [positions[3 * b], positions[3 * b + 1], positions[3 * b + 2]],
                      [positions[3 * c], positions[3 * c + 1], positions[3 * c + 2]]);
    }
    return area;
  };

  // record which sides incident triangles belong to; edges lying in the plane that
  // separate the two sides are cut edges even when the plane passes through vertices.
  const noteEdges = (tri, side) => {
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = a < b ? a + '_' + b : b + '_' + a;
      let e = edgeSides.get(key);
      if (!e) {
        e = { a: Math.min(a, b), b: Math.max(a, b), sides: 0, onPlane: Math.abs(sd[a]) <= eps && Math.abs(sd[b]) <= eps };
        edgeSides.set(key, e);
      }
      e.sides |= (1 << side);
    }
  };

  let crossing = 0, coplanar = 0, dropped = 0;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) { dropped++; continue; }
    let pos = false, neg = false;
    for (const v of tri) { if (sd[v] > eps) pos = true; else if (sd[v] < -eps) neg = true; }
    if (!pos && !neg) {
      // fully coplanar face: assign by its own normal
      coplanar++;
      const a = 3 * tri[0], b = 3 * tri[1], c = 3 * tri[2];
      const fn = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]],
                        [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      const s = dot3(fn, n) >= 0 ? 1 : 0;
      sides[s].push(tri[0], tri[1], tri[2]);
      noteEdges(tri, s);
      continue;
    }
    if (!(pos && neg)) {
      const s = pos ? 1 : 0;
      sides[s].push(tri[0], tri[1], tri[2]);
      noteEdges(tri, s);
      continue;
    }
    crossing++;
    for (let s = 0; s < 2; s++) {
      const dir = s === 1 ? 1 : -1;
      const poly = clipTri(tri, dir);
      if (poly.length < 3 || polyArea(poly) <= areaEps) continue;
      const base = sides[s].length;
      for (let i = 1; i + 1 < poly.length; i++) {
        sides[s].push(poly[0].id, poly[i].id, poly[i + 1].id);
      }
      if (base === sides[s].length) continue;
      // the cut edge: consecutive on-plane vertices of the kept polygon
      const cuts = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (a.cut && b.cut && a.id !== b.id) cuts.push([a.id, b.id]);
      }
      if (cuts.length !== 1) return { ok: false, reason: 'ambiguous-cut-segment', detail: cuts.length };
      segs[s].push(cuts[0]);
    }
  }

  for (const e of edgeSides.values()) {
    if (e.onPlane && e.sides === 3) {           // used by both sides -> ring edge
      segs[0].push([e.a, e.b]);
      segs[1].push([e.a, e.b]);
    }
  }

  const pieces = [];
  const stats = { crossingTriangles: crossing, coplanarTriangles: coplanar, droppedTriangles: dropped,
                  newVertices: cutKeys.length };
  for (let s = 0; s < 2; s++) {
    // stitch undirected segments into closed rings
    const adj = new Map();
    for (const [a, b] of segs[s]) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    }
    for (const [v, list] of adj) {
      if (list.length !== 2) return { ok: false, reason: 'open-cut-ring', vertex: v, degree: list.length };
    }
    const seen = new Set();
    const rings = [];
    for (const [start] of adj) {
      if (seen.has(start)) continue;
      const ring = [start];
      seen.add(start);
      let prev = -1, cur = start;
      for (let guard = 0; guard < adj.size + 2; guard++) {
        const nb = adj.get(cur).find((x) => x !== prev);
        if (nb === undefined) break;
        if (nb === start) break;
        if (seen.has(nb)) return { ok: false, reason: 'non-simple-cut-ring' };
        seen.add(nb); ring.push(nb); prev = cur; cur = nb;
      }
      if (ring.length < 3) return { ok: false, reason: 'degenerate-cut-ring', size: ring.length };
      rings.push(ring);
    }

    const { u, w } = planeBasis(n);
    const pts2 = new Map();
    const rings2 = rings.map((ring) => ring.map((id) => {
      const p = [positions[3 * id], positions[3 * id + 1], positions[3 * id + 2]];
      const q = [dot3(p, u), dot3(p, w)];
      pts2.set(id, q);
      return q;
    }));
    // nesting (holes) is refused rather than silently mis-triangulated
    for (let i = 0; i < rings2.length; i++) {
      for (let j = 0; j < rings2.length; j++) {
        if (i === j) continue;
        if (pointInPoly(rings2[j][0], rings2[i]) && !pointInPoly(rings2[i][0], rings2[j])) {
          return { ok: false, reason: 'nested-cut-rings', rings: rings2.length };
        }
      }
    }

    const capTris = [];
    for (let r = 0; r < rings.length; r++) {
      let ids = rings[r].slice();
      if (signedArea2(rings2[r]) < 0) { ids.reverse(); rings2[r].reverse(); }
      const res = earClip(pts2, ids, 0);
      if (res.remaining.length) return { ok: false, reason: 'ear-clip-stuck', ring: r };
      // plus side's outward normal at the cut plane is -n, so its cap is reversed
      const tri = res.triangles.slice();
      if (s === 1) { for (let k = 0; k < tri.length; k += 3) { const tmp = tri[k + 1]; tri[k + 1] = tri[k + 2]; tri[k + 2] = tmp; } }
      capTris.push(...tri);
    }

    const all = sides[s].concat(capTris);
    // compact: keep only referenced vertices
    const remap = new Map();
    const pp = [];
    const ii = [];
    for (const gid of all) {
      let lid = remap.get(gid);
      if (lid === undefined) {
        lid = pp.length / 3;
        remap.set(gid, lid);
        pp.push(positions[3 * gid], positions[3 * gid + 1], positions[3 * gid + 2]);
      }
      ii.push(lid);
    }
    const piece = { positions: pp, indices: ii, rings: rings.length, capTriangles: capTris.length / 3 };
    piece.volume = signedVolume(pp, ii);
    piece.audit = auditMesh(piece);
    pieces.push(piece);
  }

  for (const p of pieces) {
    if (p.indices.length === 0) return { ok: false, reason: 'plane-misses-solid', stats };
  }
  for (const p of pieces) {
    if (p.rings === 0) return { ok: false, reason: 'no-cross-section', stats };
    if (!p.audit.closed) return { ok: false, reason: 'result-not-closed', stats, audit: p.audit };
  }
  return {
    ok: true,
    plane: { n, d },
    eps,
    pieces,
    cutArea: pieces[0].capTriangles ? capAreaOf(pieces[0]) : 0,
    stats,
  };
}

function capAreaOf(piece) {
  // cap triangles are the last capTriangles*3 indices appended by splitMesh
  const idx = piece.indices;
  const pos = piece.positions;
  const capIdx = idx.slice(idx.length - piece.capTriangles * 3);
  let area = 0;
  for (let t = 0; t < capIdx.length; t += 3) {
    const a = capIdx[t] * 3, b = capIdx[t + 1] * 3, c = capIdx[t + 2] * 3;
    area += triArea([pos[a], pos[a + 1], pos[a + 2]], [pos[b], pos[b + 1], pos[b + 2]],
                    [pos[c], pos[c + 1], pos[c + 2]]);
  }
  return area;
}

export function capArea(piece) { return capAreaOf(piece); }
// FNV-1a over a canonical, scale-normalised description of a split result.
// Same doubles -> same string, so node-baked expectations can be compared in the browser.
export function fingerprintSplit(result) {
  if (!result || !result.ok) return 'refused';
  const diag = Math.max(...result.pieces.flatMap((p) => [bboxDiag(p.positions)]));
  const parts = [result.pieces[0].rings, result.pieces[1].rings];
  for (const p of result.pieces) {
    parts.push(p.indices.length / 3, p.capTriangles);
    parts.push((p.volume / (diag ** 3)).toFixed(12));
    parts.push((capAreaOf(p) / (diag ** 2)).toFixed(12));
  }
  const s = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
