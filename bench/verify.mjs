// Assertions over the generated corpus. Real numbers only; every line prints what it saw.
import { readFileSync } from 'node:fs';
import { splitMesh, auditMesh, signedVolume, bbox, bboxDiag, capArea, fingerprintSplit } from '../src/core.mjs';
import { naiveClip } from '../baseline/naive.mjs';

const corpus = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url)));
let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log(`PASS  ${label}  [${detail}]`); }
  else { fail++; console.log(`FAIL  ${label}  [${detail}]`); }
  return cond;
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function planeFor(mesh, cut) {
  const nl = Math.hypot(cut.n[0], cut.n[1], cut.n[2]);
  const n = [cut.n[0] / nl, cut.n[1] / nl, cut.n[2] / nl];
  const bb = bbox(mesh.positions);
  const c = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
  let half = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const s = n[0] * mesh.positions[i] + n[1] * mesh.positions[i + 1] + n[2] * mesh.positions[i + 2];
    half = Math.max(half, Math.abs(s - (n[0] * c[0] + n[1] * c[1] + n[2] * c[2])));
  }
  return { n, d: n[0] * c[0] + n[1] * c[1] + n[2] * c[2] + cut.t * half };
}
const boxDiag = (m) => bboxDiag(m.positions);
const halfExtent = (m, n) => {
  const bb = bbox(m.positions);
  const c = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
  const cd = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
  let h = 0;
  for (let i = 0; i < m.positions.length; i += 3) {
    h = Math.max(h, Math.abs(n[0] * m.positions[i] + n[1] * m.positions[i + 1] + n[2] * m.positions[i + 2] - cd));
  }
  return h;
};
const scaleMesh = (mesh, s) => ({ positions: mesh.positions.map((v) => v * s), indices: mesh.indices.slice() });

console.log('== A. corpus integrity ==');
for (const m of corpus.meshes) {
  const a = auditMesh(m);
  ok(a.closed && a.boundaryEdges === 0, `corpus ${m.name} closed`, `tris=${a.triangles} bnd=${a.boundaryEdges} flip=${a.flippedEdges} V=${signedVolume(m.positions, m.indices).toFixed(6)}`);
}

console.log('== B. every non-nested cut -> two closed solids ==');
let cutsRun = 0, piecesClosed = 0, maxVolDrift = 0, maxCapDiff = 0;
for (const m of corpus.meshes) {
  if (m.name === 'torus') continue;          // torus cuts are exercised in section E
  for (const cut of m.cuts) {
    const plane = planeFor(m, cut);
    const r = splitMesh(m, plane);
    cutsRun++;
    ok(r.ok, `cut ${m.name} n=${cut.n.join(',')} t=${cut.t} accepted`, r.ok ? `pieces=${r.pieces.length}` : `refused: ${r.reason}`);
    if (!r.ok) continue;
    for (const [k, p] of r.pieces.entries()) {
      if (ok(p.audit.closed, `piece ${k + 1}/${m.name} watertight`, `bnd=${p.audit.boundaryEdges} nonManifold=${p.audit.nonManifoldEdges} flipped=${p.audit.flippedEdges} tris=${p.audit.triangles}`)) piecesClosed++;
      ok(p.volume > 0, `piece ${k + 1}/${m.name} positive oriented volume`, `V=${p.volume.toFixed(9)}`);
    }
    const V = signedVolume(m.positions, m.indices);
    const drift = rel(r.pieces[0].volume + r.pieces[1].volume, V);
    maxVolDrift = Math.max(maxVolDrift, drift);
    ok(drift < 1e-12, `cut ${m.name} volume additivity`, `V1+V2=${(r.pieces[0].volume + r.pieces[1].volume).toFixed(12)} V=${V.toFixed(12)} rel=${drift.toExponential(2)}`);
    const c0 = capArea(r.pieces[0]), c1 = capArea(r.pieces[1]);
    const capDiff = rel(c0, c1);
    maxCapDiff = Math.max(maxCapDiff, capDiff);
    ok(capDiff < 1e-12, `cut ${m.name} cap areas agree`, `A1=${c0.toFixed(12)} A2=${c1.toFixed(12)} rel=${capDiff.toExponential(2)}`);
  }
}
ok(cutsRun === 15, 'valid-cut corpus size', `cuts=${cutsRun}`);
ok(piecesClosed === 2 * cutsRun, 'watertight pieces', `${piecesClosed}/${2 * cutsRun}`);
console.log(`SUMMARY watertight=${piecesClosed}/${2 * cutsRun} maxVolumeAdditivityRel=${maxVolDrift.toExponential(2)} maxCapAreaRel=${maxCapDiff.toExponential(2)}`);

console.log('== C. exact analytic oracle: box [-1,1]^3 cut by z=d ==');
const box = corpus.meshes.find((m) => m.name === 'box');
const exactBox = [
  { d: -0.4, vPlus: 4 * 1.4, vMinus: 4 * 0.6, area: 4 },
  { d: 0.0, vPlus: 4, vMinus: 4, area: 4 },
  { d: 0.55, vPlus: 4 * 0.45, vMinus: 4 * 1.55, area: 4 },
];
let maxExactErr = 0;
for (const e of exactBox) {
  const r = splitMesh(box, { n: [0, 0, 1], d: e.d });
  if (!ok(r.ok, `exact cut z=${e.d} accepted`, r.ok ? 'ok' : r.reason)) continue;
  const errPlus = rel(r.pieces[1].volume, e.vPlus), errMinus = rel(r.pieces[0].volume, e.vMinus);
  maxExactErr = Math.max(maxExactErr, errPlus, errMinus);
  ok(errPlus < 1e-12 && errMinus < 1e-12, `exact cut z=${e.d} volumes`,
     `plus=${r.pieces[1].volume.toFixed(12)} (analytic ${e.vPlus}) minus=${r.pieces[0].volume.toFixed(12)} (analytic ${e.vMinus})`);
  ok(rel(capArea(r.pieces[0]), e.area) < 1e-12, `exact cut z=${e.d} cross-section area`,
     `A=${capArea(r.pieces[0]).toFixed(12)} analytic=${e.area}`);
}
console.log(`SUMMARY maxExactVolumeRel=${maxExactErr.toExponential(2)}`);

console.log('== D. baseline: clip-only leaves open borders ==');
let naiveBoundary = 0, naiveCuts = 0, naiveWorstVolErr = 0;
for (const m of corpus.meshes) {
  if (m.name === 'torus' || m.cuts.length === 0) continue;
  const cut = m.cuts[0];
  const plane = planeFor(m, cut);
  const nv = naiveClip(m, plane);
  naiveCuts++;
  const total = nv.boundaryEdges;
  naiveBoundary += total;
  const V = signedVolume(m.positions, m.indices);
  const naiveV = signedVolume(nv.pieces[0].positions, nv.pieces[0].indices) + signedVolume(nv.pieces[1].positions, nv.pieces[1].indices);
  const err = Math.abs(naiveV - V) / Math.abs(V);
  naiveWorstVolErr = Math.max(naiveWorstVolErr, err);
  ok(total > 0, `baseline ${m.name} is not closed`, `boundaryEdges=${total} (a real solid needs 0)`);
  console.log(`      baseline ${m.name}: signed volume ${naiveV.toFixed(6)} vs original ${V.toFixed(6)} (rel ${err.toExponential(2)})`);
}
ok(naiveCuts === 8 && naiveBoundary > 0, 'baseline summary', `meshes=${naiveCuts} openBoundaryEdges=${naiveBoundary} worstSignedVolumeRel=${naiveWorstVolErr.toExponential(2)}`);

console.log('== E. refusal contract (no silent broken solids) ==');
const torus = corpus.meshes.find((m) => m.name === 'torus');
const torusZ = planeFor(torus, { n: [0, 0, 1], t: 0 });
const rz = splitMesh(torus, torusZ);
ok(!rz.ok && rz.reason === 'nested-cut-rings', 'annular cross-section refused',
   `${rz.ok ? 'accepted (bad)' : rz.reason} rings=${rz.rings ?? '?'} (cap would need hole bridging)`);
const rx = splitMesh(torus, planeFor(torus, { n: [1, 0, 0], t: 0.2 }));
ok(rx.ok && rx.pieces.every((p) => p.rings === 2), 'two disjoint cut rings accepted',
   rx.ok ? `rings=${rx.pieces.map((p) => p.rings).join('/')} bnd=${rx.pieces.map((p) => p.audit.boundaryEdges).join('/')}` : rx.reason);
const far = splitMesh(box, { n: [0, 0, 1], d: 99 });
ok(!far.ok && far.reason === 'plane-misses-solid', 'plane outside solid refused', far.ok ? 'accepted (bad)' : far.reason);

console.log('== F. scale invariance 1e-6 .. 1e6 (relative eps) ==');
let maxScaleDrift = 0, scaleRuns = 0;
for (const name of ['box', 'lprism', 'sphere24']) {
  const m = corpus.meshes.find((x) => x.name === name);
  const cut = m.cuts[1] || m.cuts[0];
  const base = planeFor(m, cut);
  const diag0 = bboxDiag(m.positions);
  let refNorm = null, refRings = null;
  for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
    const sm = scaleMesh(m, s);
    const sp = { n: base.n, d: base.d * s };
    const r = splitMesh(sm, sp);
    scaleRuns++;
    ok(r.ok && r.pieces.every((p) => p.audit.closed), `scale ${name} x${s} watertight`,
       r.ok ? `bnd=${r.pieces.map((p) => p.audit.boundaryEdges).join('/')}` : `refused: ${r.reason}`);
    if (!r.ok) continue;
    const norm = r.pieces[0].volume / Math.pow(bboxDiag(sm.positions), 3);
    if (refNorm === null) { refNorm = norm; refRings = r.pieces[0].rings; }
    else {
      const drift = rel(norm, refNorm);
      maxScaleDrift = Math.max(maxScaleDrift, drift);
      ok(drift < 1e-9 && r.pieces[0].rings === refRings, `scale ${name} x${s} normalized volume`,
         `V/diag^3=${norm.toExponential(12)} ref=${refNorm.toExponential(12)} rel=${drift.toExponential(2)} rings=${r.pieces[0].rings}`);
    }
  }
}
console.log(`SUMMARY scaleRuns=${scaleRuns} maxNormalizedVolumeDrift=${maxScaleDrift.toExponential(2)}`);

console.log('== G. browser-baked expectations match fresh node splits ==');
const baked = JSON.parse(readFileSync(new URL('../data/expected.json', import.meta.url)));
const boxMesh = corpus.meshes.find((m) => m.name === 'box');
let bakedChecked = 0, bakedMismatch = 0;
for (const e of baked.entries) {
  if (![0.3, 0, -0.6].includes(e.offset)) continue;
  const r = splitMesh(boxMesh, { n: e.n, d: planeFor(boxMesh, { n: e.n, t: 0 }).d + e.offset * halfExtent(boxMesh, e.n) });
  if (!r.ok) { ok(false, `baked plane ${e.offset} recompute`, r.reason); continue; }
  bakedChecked++;
  const fp = fingerprintSplit(r);
  bakedMismatch += fp === e.fingerprint ? 0 : 1;
  ok(fp === e.fingerprint, `baked fingerprint at offset ${e.offset}`,
     `fresh=${fp} baked=${e.fingerprint} V=${r.pieces[1].volume.toFixed(6)}/${r.pieces[0].volume.toFixed(6)}`);
}
console.log(`SUMMARY bakedPlanesChecked=${bakedChecked} mismatches=${bakedMismatch}`);

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);