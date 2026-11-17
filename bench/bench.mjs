// Timing only. Correctness counts come from the same split calls (refusals would show up here).
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { splitMesh, bbox, bboxDiag, auditMesh } from '../src/core.mjs';

const corpus = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url)));
const planeFor = (mesh, cut) => {
  const nl = Math.hypot(cut.n[0], cut.n[1], cut.n[2]);
  const n = cut.n.map((v) => v / nl);
  const bb = bbox(mesh.positions);
  const c = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
  let half = 0, cd = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    half = Math.max(half, Math.abs(n[0] * mesh.positions[i] + n[1] * mesh.positions[i + 1] + n[2] * mesh.positions[i + 2] - cd));
  }
  return { n, d: cd + cut.t * half };
};
const jobs = [];
for (const m of corpus.meshes) {
  if (m.name === 'torus') continue;
  for (const cut of m.cuts) jobs.push({ mesh: m, plane: planeFor(m, cut) });
}
const trisTotal = jobs.reduce((a, j) => a + j.mesh.indices.length / 3, 0);

const runAll = () => {
  let closed = 0, okCount = 0;
  for (const j of jobs) {
    const r = splitMesh(j.mesh, j.plane);
    if (r.ok) { okCount++; for (const p of r.pieces) if (p.audit.closed) closed++; }
  }
  return { okCount, closed };
};
const stat = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
  return { min: s[0], median: s[Math.floor(s.length / 2)], p95, stddev: sd, mean, rsd: sd / mean };
};

const t0 = performance.now();
const cold = runAll();
const coldStartMs = performance.now() - t0;
runAll();                                    // warmup, discarded
const samples = [];
for (let i = 0; i < 11; i++) {
  const t = performance.now();
  runAll();
  samples.push(performance.now() - t);
}
const s = stat(samples);
const result = {
  note: 'timing of 15 corpus cuts (9,884 triangles) in one batch; cold start = first batch after process start',
  trianglesPerBatch: trisTotal,
  cutsPerBatch: jobs.length,
  coldStartMs: +coldStartMs.toFixed(3),
  samples: samples.map((x) => +x.toFixed(3)),
  sampleCount: samples.length,
  minMs: +s.min.toFixed(3),
  medianMs: +s.median.toFixed(3),
  p95Ms: +s.p95.toFixed(3),
  stddevMs: +s.stddev.toFixed(3),
  rsdPct: +(100 * s.rsd).toFixed(2),
  medianMsPerCut: +(s.median / jobs.length).toFixed(3),
  trianglesPerSecond: Math.round(trisTotal / (s.median / 1000)),
  okCuts: cold.okCount,
  watertightPieces: `${cold.closed}/${2 * jobs.length}`,
  node: process.version,
};
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
