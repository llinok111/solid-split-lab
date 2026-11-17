// Independent oracle: no import from src/core.mjs for the measurement itself.
// Enclosed volume of each produced piece is estimated by ray-parity Monte Carlo with its
// own PRNG, ray direction and intersection routine; closedness is re-audited with a
// different edge representation. Nothing here shares a magic constant with core.mjs.
import { readFileSync } from 'node:fs';
import { splitMesh, bbox, bboxDiag } from '../src/core.mjs';
import { naiveClip } from '../baseline/naive.mjs';

const corpus = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url)));
const N = 40000;
let pass = 0, fail = 0;
const ok = (c, label, detail) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${label}  [${detail}]`); return c; };

function planeFor(mesh, cut) {
  const nl = Math.hypot(...cut.n);
  const n = cut.n.map((v) => v / nl);
  const bb = bbox(mesh.positions);
  const c = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
  let half = 0; const cd = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
  for (let i = 0; i < mesh.positions.length; i += 3) half = Math.max(half, Math.abs(n[0] * mesh.positions[i] + n[1] * mesh.positions[i + 1] + n[2] * mesh.positions[i + 2] - cd));
  return { n, d: cd + cut.t * half };
}

// --- independent closedness audit: sort the 3*T directed edges, expect pairs (a,b),(b,a) ---
function closedByPairing(piece) {
  const T = piece.indices.length / 3;
  const dir = [];
  for (let t = 0; t < T; t++) {
    const a = piece.indices[3 * t], b = piece.indices[3 * t + 1], c = piece.indices[3 * t + 2];
    dir.push(a * 100000 + b, b * 100000 + c, c * 100000 + a);
  }
  dir.sort((x, y) => x - y);
  const set = new Set(dir);
  let unmatched = 0;
  for (const x of dir) {
    const need = (x % 100000) * 100000 + Math.floor(x / 100000);
    if (!set.has(need)) unmatched++;
  }
  return { unmatched, halfEdges: dir.length };
}

// --- independent volume estimator: random rays with irrational-ish direction ---
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function insideByParity(pos, idx, px, py, pz) {
  const dx = 0.3713906763, dy = 0.5291034781, dz = 0.7638421197;   // unit-ish, unrelated to any core value
  let hits = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const sx = px - pos[a], sy = py - pos[a + 1], sz = pz - pos[a + 2];
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (tt > 1e-9) hits++;
  }
  return (hits & 1) === 1;
}
function estimateVolume(piece, seed) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < piece.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], piece.positions[i + k]); hi[k] = Math.max(hi[k], piece.positions[i + k]);
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const boxV = ext[0] * ext[1] * ext[2];
  const rnd = mulberry(seed);
  let inside = 0;
  for (let n = 0; n < N; n++) {
    if (insideByParity(piece.positions, piece.indices, lo[0] + ext[0] * rnd(), lo[1] + ext[1] * rnd(), lo[2] + ext[2] * rnd())) inside++;
  }
  const frac = inside / N;
  const sigma = Math.sqrt(frac * (1 - frac) / N);
  return { volume: frac * boxV, frac, relSigma: sigma / Math.max(frac, 1e-12) };
}

console.log('== independent closedness (sorted directed edge pairing) ==');
let audited = 0;
for (const name of ['box', 'lprism', 'cyl24', 'sphere24']) {
  const m = corpus.meshes.find((x) => x.name === name);
  const r = splitMesh(m, planeFor(m, m.cuts[0]));
  if (!r.ok) { ok(false, `${name} split`, r.reason); continue; }
  for (const [k, p] of r.pieces.entries()) {
    audited++;
    const a = closedByPairing(p);
    ok(a.unmatched === 0, `${name} piece ${k + 1} paired half-edges`, `unmatched=${a.unmatched}/${a.halfEdges}`);
  }
}
console.log(`SUMMARY piecesAudited=${audited}`);

console.log('== independent enclosed-volume estimate (ray parity, 40k samples/piece) ==');
let worst = 0, checked = 0;
for (const [name, cutIdx] of [['box', 0], ['lprism', 0], ['cyl24', 0], ['sphere24', 0]]) {
  const m = corpus.meshes.find((x) => x.name === name);
  const r = splitMesh(m, planeFor(m, m.cuts[cutIdx]));
  for (const [k, p] of r.pieces.entries()) {
    const est = estimateVolume(p, 1000 + 17 * k + name.length);
    const err = Math.abs(est.volume - p.volume) / Math.max(p.volume, 1e-12);
    worst = Math.max(worst, err); checked++;
    ok(err < 6 * est.relSigma + 1e-6, `${name} piece ${k + 1} volume matches signed volume`,
       `parity=${est.volume.toFixed(5)} core=${p.volume.toFixed(5)} rel=${err.toExponential(2)} 6sigma=${(6 * est.relSigma).toExponential(2)}`);
  }
}
console.log(`SUMMARY volumeChecks=${checked} worstRelativeDeviation=${worst.toExponential(2)}`);

console.log('== the same estimator on the uncapped baseline (open surface) ==');
{
  const box = corpus.meshes.find((x) => x.name === 'box');
  const plane = planeFor(box, box.cuts[0]);
  const nv = naiveClip(box, plane);
  const r = splitMesh(box, plane);
  let wrong = 0;
  for (const [k, p] of nv.pieces.entries()) {
    const est = estimateVolume(p, 4242 + k);
    const truth = r.pieces[k].volume;
    const err = Math.abs(est.volume - truth) / truth;
    if (err > 0.1) wrong++;
    console.log(`      naive piece ${k + 1}: parity=${est.volume.toFixed(5)} capped=${truth.toFixed(5)} rel=${(100 * err).toFixed(1)}%` +
      (err > 0.1 ? ' (wrong)' : ' (accidentally right: the open ring is occluded from the sampled rays)'));
  }
  ok(wrong >= 1, 'naive open surface yields an invalid enclosed volume', `piecesWrongByMoreThan10pct=${wrong}/2`);
}

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
