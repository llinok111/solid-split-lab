// Deterministic corpus generator: node tools/gen-sample.mjs -> data/corpus.json
// No randomness, no clock, no network. Running twice produces byte-identical output.
import { writeFileSync, mkdirSync } from 'node:fs';

const out = [];

function push(name, positions, indices, cuts) {
  out.push({ name, positions: positions.map((v) => +v.toFixed(12)), indices, cuts });
}

function box(hx = 1, hy = 1, hz = 1) {
  const p = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ].flat();
  const i = [
    0, 2, 1, 0, 3, 2,   // -z
    4, 5, 6, 4, 6, 7,   // +z
    0, 1, 5, 0, 5, 4,   // -y
    3, 7, 6, 3, 6, 2,   // +y
    0, 4, 7, 0, 7, 3,   // -x
    1, 2, 6, 1, 6, 5,   // +x
  ];
  return { positions: p, indices: i };
}

function tetra() {
  const p = [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1];
  const i = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
  return { positions: p, indices: i };
}

function octa() {
  const p = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
  const i = [
    0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4,
    2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
  ];
  return { positions: p, indices: i };
}

function icosa() {
  const t = (1 + Math.sqrt(5)) / 2;
  const p = [
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ];
  const i = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  return { positions: p.map((v) => v / Math.hypot(1, t)), indices: i };
}

// Non-convex L-shaped prism: exercises a concave cut ring.
function lprism(h = 1) {
  const poly = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const n = poly.length;
  const positions = [];
  for (const z of [-h, h]) for (const [x, y] of poly) positions.push(x - 1, y - 1, z);
  const indices = [];
  for (let k = 1; k + 1 < n; k++) indices.push(n + 0, n + k, n + k + 1);   // top (+z)
  for (let k = 1; k + 1 < n; k++) indices.push(0, k + 1, k);                // bottom (-z)
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    indices.push(k, j, n + j, k, n + j, n + k);
  }
  return { positions, indices };
}

function cylinder(seg = 24, r = 1, h = 1) {
  const positions = [];
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    positions.push(r * Math.cos(a), r * Math.sin(a), -h);
  }
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    positions.push(r * Math.cos(a), r * Math.sin(a), h);
  }
  positions.push(0, 0, -h, 0, 0, h);
  const cb = 2 * seg, ct = 2 * seg + 1;
  const indices = [];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    indices.push(i, j, seg + j, i, seg + j, seg + i);
    indices.push(cb, j, i);
    indices.push(ct, seg + i, seg + j);
  }
  return { positions, indices };
}

function torus(segU = 24, segV = 10, R = 1, r = 0.35) {
  const positions = [], indices = [];
  for (let i = 0; i < segU; i++) {
    const u = (2 * Math.PI * i) / segU;
    for (let j = 0; j < segV; j++) {
      const v = (2 * Math.PI * j) / segV;
      positions.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v));
    }
  }
  for (let i = 0; i < segU; i++) {
    const i2 = (i + 1) % segU;
    for (let j = 0; j < segV; j++) {
      const j2 = (j + 1) % segV;
      const a = i * segV + j, b = i2 * segV + j, c = i2 * segV + j2, d = i * segV + j2;
      indices.push(a, c, b, a, d, c);
    }
  }
  return { positions, indices };
}

// Welded UV sphere; also used as the large perf mesh at 96x48.
function sphere(lon = 24, lat = 12, r = 1) {
  const positions = [];
  const ring = [];   // [lon][lat-1] interior latitudes
  for (let i = 0; i < lon; i++) {
    ring.push([]);
    const phi = (2 * Math.PI * i) / lon;
    for (let j = 1; j < lat; j++) {
      const th = (Math.PI * j) / lat;
      positions.push(r * Math.sin(th) * Math.cos(phi), r * Math.sin(th) * Math.sin(phi), r * Math.cos(th));
      ring[i].push(positions.length / 3 - 1);
    }
  }
  const top = positions.length / 3;
  positions.push(0, 0, r);
  const bot = positions.length / 3;
  positions.push(0, 0, -r);
  const indices = [];
  for (let i = 0; i < lon; i++) {
    const i2 = (i + 1) % lon;
    indices.push(top, ring[i][0], ring[i2][0]);
    const last = lat - 2;
    indices.push(bot, ring[i2][last], ring[i][last]);
    for (let j = 0; j + 1 < lat - 1; j++) {
      const a = ring[i][j], b = ring[i2][j], c = ring[i2][j + 1], d = ring[i][j + 1];
      indices.push(a, c, b, a, d, c);
    }
  }
  return { positions, indices };
}

function outward(mesh) {
  // flip winding if the closed mesh came out inward
  const pos = mesh.positions, idx = mesh.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (v < 0) {
    const fixed = [];
    for (let t = 0; t < idx.length; t += 3) fixed.push(idx[t], idx[t + 2], idx[t + 1]);
    return { positions: pos, indices: fixed };
  }
  return mesh;
}

// t = signed offset as a fraction of the mesh's half-extent along n
push('box', ...Object.values(box()), [
  { n: [0, 0, 1], t: 0.35 }, { n: [0.6, 0.48, 0.64], t: 0.2 }, { n: [0, 0, 1], t: 0 },
]);
push('tetra', ...Object.values(tetra()), [
  { n: [0, 0, 1], t: 0.15 }, { n: [0.577, 0.577, 0.577], t: 0.1 },
]);
push('octa', ...Object.values(octa()), [
  { n: [1, 1, 1], t: 0 }, { n: [0, 0, 1], t: 0.3 },
]);
push('icosa', ...Object.values(icosa()), [
  { n: [0.3, 0.5, 0.81], t: 0.15 }, { n: [0, 0, 1], t: -0.2 },
]);
push('lprism', ...Object.values(lprism()), [
  { n: [0, 0, 1], t: 0 }, { n: [1, 0, 0.2], t: 0 },
]);
push('cyl24', ...Object.values(cylinder()), [
  { n: [0, 0, 1], t: 0.3 }, { n: [0.5, 0, 0.866], t: 0 },
]);
push('sphere24', ...Object.values(sphere()), [
  { n: [0.2, 0.3, 0.93], t: 0.2 },
]);
push('torus', ...Object.values(torus()), [
  { n: [0, 0, 1], t: 0 }, { n: [1, 0, 0], t: 0 },
]);
push('sphere96', ...Object.values(sphere(96, 48)), [{ n: [0.2, 0.3, 0.93], t: 0.25 }]);

for (const m of out) {
  const o = outward(m);
  m.positions = o.positions.map((v) => +v.toFixed(12));
  m.indices = o.indices;
}

// node-baked expectations for the browser: box cut by z or a tilted normal, on a grid
const { splitMesh, fingerprintSplit, bbox, bboxDiag, capArea } = await import('../src/core.mjs');
const boxMesh = out.find((m) => m.name === 'box');
const bb = bbox(boxMesh.positions);
const center = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
const diag = bboxDiag(boxMesh.positions);
const expected = [];
for (const spec of [{ n: [0, 0, 1], step: 0.05, span: 0.9 }, { n: [0.6, 0.48, 0.64], step: 0.1, span: 0.8 }]) {
  const nl = Math.hypot(...spec.n);
  const n = spec.n.map((v) => v / nl);
  const base = n[0] * center[0] + n[1] * center[1] + n[2] * center[2];
  let half = 0;
  for (let i = 0; i < boxMesh.positions.length; i += 3) {
    half = Math.max(half, Math.abs(n[0] * boxMesh.positions[i] + n[1] * boxMesh.positions[i + 1] + n[2] * boxMesh.positions[i + 2] - base));
  }
  for (let t = -spec.span; t <= spec.span + 1e-9; t += spec.step) {
    const off = +t.toFixed(4);
    const r = splitMesh(boxMesh, { n, d: base + off * half });
    expected.push({ n: n.map((v) => +v.toFixed(6)), offset: off, fingerprint: fingerprintSplit(r),
      vPlus: r.ok ? +r.pieces[1].volume.toFixed(9) : null, vMinus: r.ok ? +r.pieces[0].volume.toFixed(9) : null,
      capArea: r.ok ? +capArea(r.pieces[0]).toFixed(9) : null, closed: r.ok ? r.pieces.every((p) => p.audit.closed) : false,
      refused: r.ok ? null : r.reason });
  }
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/corpus.json', import.meta.url), JSON.stringify({ version: 1, meshes: out }));
writeFileSync(new URL('../data/expected.json', import.meta.url), JSON.stringify({
  mesh: 'box', diag: +diag.toFixed(12), center, entries: expected,
}, null, 0));
console.log(`wrote data/expected.json: ${expected.length} baked planes`);
console.log(`wrote data/corpus.json: ${out.length} meshes, ${out.map((m) => m.indices.length / 3).reduce((a, b) => a + b, 0)} triangles, ` +
  `${out.reduce((a, m) => a + m.cuts.length, 0)} cuts`);