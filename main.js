// Render + interaction only. Every number on screen comes from src/core.mjs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { splitMesh, fingerprintSplit, bbox, bboxDiag, capArea, signedVolume } from './src/core.mjs';

const [corpus, expected] = await Promise.all([
  fetch('./data/corpus.json').then((r) => r.json()),
  fetch('./data/expected.json').then((r) => r.json()),
]);
const mesh = corpus.meshes.find((m) => m.name === 'box');
const bb = bbox(mesh.positions);
const center = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
const diag = bboxDiag(mesh.positions);
const originalVolume = signedVolume(mesh.positions, mesh.indices);
const normals = [[0, 0, 1], [0.6, 0.48, 0.64]];

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, view.clientWidth / view.clientHeight, 0.01, 100);
camera.position.set(3.2, 2.4, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xdfefff, 0x202830, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0x88bbff, 1.0); rim.position.set(-5, -3, -4); scene.add(rim);
scene.add(new THREE.GridHelper(10, 20, 0x2b3a4d, 0x1a2430));

const matSolid = [new THREE.MeshStandardMaterial({ color: 0x4f9cf9, metalness: 0.15, roughness: 0.55, flatShading: true }),
                  new THREE.MeshStandardMaterial({ color: 0xe8a33d, metalness: 0.1, roughness: 0.5, flatShading: true, side: THREE.DoubleSide })];
const matSolid2 = [new THREE.MeshStandardMaterial({ color: 0x35c48b, metalness: 0.15, roughness: 0.55, flatShading: true }),
                   new THREE.MeshStandardMaterial({ color: 0xe8a33d, metalness: 0.1, roughness: 0.5, flatShading: true, side: THREE.DoubleSide })];

const group = new THREE.Group();
scene.add(group);
let wire = false, lastResult = null;

function planeFor(nIdx, offset) {
  const nl = Math.hypot(...normals[nIdx]);
  const n = normals[nIdx].map((v) => v / nl);
  const base = n[0] * center[0] + n[1] * center[1] + n[2] * center[2];
  let half = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    half = Math.max(half, Math.abs(n[0] * mesh.positions[i] + n[1] * mesh.positions[i + 1] + n[2] * mesh.positions[i + 2] - base));
  }
  return { n, d: base + offset * half };
}

function buildPiece(piece, mats) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(piece.positions, 3));
  g.setIndex(piece.indices.slice());
  const capCount = piece.capTriangles * 3;
  const solidCount = piece.indices.length - capCount;
  g.addGroup(0, solidCount, 0);
  g.addGroup(solidCount, capCount, 1);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mats);
  if (wire) m.material = mats.map((x) => new THREE.MeshBasicMaterial({ color: x.color, wireframe: true }));
  return m;
}

function rebuild() {
  const nIdx = +document.getElementById('normal').value;
  const offset = +document.getElementById('offset').value;
  document.getElementById('offsetVal').textContent = offset.toFixed(2);
  const plane = planeFor(nIdx, offset);
  const r = splitMesh(mesh, plane);
  lastResult = r;
  while (group.children.length) { const c = group.children.pop(); c.geometry.dispose(); c.material.dispose?.(); }
  if (!r.ok) {
    document.getElementById('fp').textContent = 'refused: ' + r.reason;
    return;
  }
  group.add(buildPiece(r.pieces[1], matSolid));
  group.add(buildPiece(r.pieces[0], matSolid2));
  const fmt = (x) => x.toFixed(6);
  document.getElementById('vPlus').textContent = fmt(r.pieces[1].volume);
  document.getElementById('vMinus').textContent = fmt(r.pieces[0].volume);
  document.getElementById('vSum').textContent = fmt(r.pieces[1].volume + r.pieces[0].volume);
  document.getElementById('vOrig').textContent = fmt(originalVolume);
  document.getElementById('caps').textContent = fmt(capArea(r.pieces[0])) + ' / ' + fmt(capArea(r.pieces[1]));
  const wt = r.pieces.map((p) => (p.audit.closed ? 'yes' : 'no (' + p.audit.boundaryEdges + ' open)'));
  document.getElementById('wt').textContent = wt.join(' / ');
  document.getElementById('wt').className = r.pieces.every((p) => p.audit.closed) ? 'good' : 'bad';

  const fp = fingerprintSplit(r);
  const rounded = normals[nIdx].map((v) => +(v / Math.hypot(...normals[nIdx])).toFixed(6));
  const entry = expected.entries.find((e) => e.normal.every((v, i) => Math.abs(v - rounded[i]) < 1e-6) && Math.abs(e.offset - offset) < 1e-6);
  const el = document.getElementById('fp');
  if (!entry) { el.textContent = 'browser ' + fp + '\nno baked plane at offset ' + offset.toFixed(2); el.className = ''; }
  else {
    const match = entry.fingerprint === fp;
    el.textContent = 'browser ' + fp + '\nnode    ' + entry.fingerprint + '\n' + (match ? 'MATCH' : 'MISMATCH');
    el.className = match ? 'good' : 'bad';
    document.getElementById('fpHint').textContent = match
      ? 'The browser and the node bench agree bit for bit on this plane (volume, cap area, triangle counts).'
      : 'Mismatch — do not trust the browser numbers.';
  }
}

document.getElementById('normal').addEventListener('change', rebuild);
document.getElementById('offset').addEventListener('input', rebuild);
document.getElementById('wire').addEventListener('change', (e) => { wire = e.target.checked; rebuild(); });
addEventListener('resize', () => {
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(view.clientWidth, view.clientHeight);
});
rebuild();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
