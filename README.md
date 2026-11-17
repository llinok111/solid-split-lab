# solid-split-lab

**Plane-cut a closed triangle mesh into two *closed* solids:** 15/15 non-annular corpus cuts accepted (16/17 overall — the annulus is refused by contract), **30/30 pieces watertight** (0 open, 0 non-manifold, 0 flipped edges) with volume error **4.3e-16** against an analytic box oracle. The baseline that clips triangles without caps — what most browser "section plane" demos do — leaves **2,136 open boundary edges** on 8 cuts and an enclosed-volume estimate that is **65.5% wrong** on one half.

Upstream: none

Most three.js clipping demos show a cross-section and stop there. A cross-section is not a solid: the cut is open, so it cannot be 3D-printed, cannot be volume-measured, cannot be fed to a physics engine. This tool builds the cap, welds its ring to the clipped fragments, and **refuses** (with a reason) whenever it cannot produce a closed solid — a wrong solid is worse than a refusal.

## 本轮创新 (what is new)

B 档：把一个「剖切面」从**视觉裁剪**变成**可审计的实体分割**。核心数字能在 node 里复算，也能在浏览器里用同一个 core 现场复算并和 node 烘焙的 FNV 指纹逐位比对：

- 分割结果的两块都是闭合实体，对精确解析的立方体切面误差 4.3e-16，对独立 ray-parity 体积估计（不共用常量）最大偏差 1.02%；
- 剖切环相切、嵌套（圆环面横切 → 圆环截面）、平面穿过顶点、平面完全在体外等情形**全部显式拒绝**，不存在「静默给出破面」的路径；
- 与 `mesh-slice-lab`（只出截面轮廓）和 CSG 结果审计工具的区别：这里交付的是**带盖的实体**及其体积账本，而不是轮廓或对别人的审计。

## How to run

```bash
node tools/gen-sample.mjs                 # deterministic corpus (already committed)
node bench/verify.mjs                     # 170 assertions, exit 0
node bench/independent.mjs                # ray-parity oracle, 17 assertions
node bench/bench.mjs                      # writes bench/result.json
python3 -m http.server 4173               # then open http://localhost:4173
```

No install step: zero npm dependencies. The browser page loads three.js **0.170.0** from a pinned CDN importmap; `src/core.mjs` is pure ESM and runs in node with no DOM.

## Evidence (real runs, node v24.19.0)

| Check | Measured | Command |
|---|---|---|
| corpus meshes closed | 9/9 | `bench/verify.mjs` §A |
| valid cuts accepted | **15/15** non-annular (16/17 overall) | §B / §E |
| watertight pieces | **30/30**, boundary=nonManifold=flipped=0 | §B |
| volume additivity V1+V2 vs V | max rel **8.7e-16** | §B |
| cap area agreement between halves | max rel **1.4e-15** | §B |
| analytic box oracle (3 planes) | max rel volume error **4.3e-16**, cap area 4.000000000000 | §C |
| baseline clip-only | **2,136 open boundary edges** over 8 cuts; enclosed volume **65.5% low** on one half, 0% on the other only because the open ring is occluded from the sampled rays | §D + `independent.mjs` |
| independent ray-parity volume (40k samples/piece) | 8/8 pieces within **1.02%**, no shared constants | `bench/independent.mjs` |
| scale invariance 1e-6 … 1e6 | 15/15 watertight, max normalized-volume drift **6.6e-16** | §F |
| refusal: annular cross-section | `nested-cut-rings` on torus z-cut (no hole bridging yet) | §E |
| refusal: plane outside solid | `plane-misses-solid` | §E |
| two disjoint cut rings | accepted, 2 rings/piece, 0 open edges (torus x-cut) | §E |
| baked browser fingerprint | 6/6 baked planes reproduce bit-identically in node | §G |
| timing, 15 cuts / 9,884 triangles | median **19.061 ms** (1.27 ms/cut, 518k tris/s), p95 25.231 ms, min 14.399 ms, **cold start 50.109 ms**, RSD 17.36% | `bench/bench.mjs` |

`bench/result.json` holds the raw samples. **RSD 17.36% > 10% and is expected:** one batch is dominated by the 9,024-triangle sphere (94% of all triangles), and each cut allocates fresh position/index arrays, so GC pauses on a 4-core box move the numbers; the median is stable across 11 samples and the cold start is reported separately (first-run JIT).

## 已知限制

- **Absolute tolerance is disclosed:** `eps = 1e-9 × bbox diagonal` (relative to the model) and sliver cutoff `areaEps = 1e-20 × diagonal²`. Verified effective across **1e-6 … 1e6** of unit scale; below ~1e-7 absolute units a 1e-9·diag epsilon approaches double rounding and the tool refuses rather than guesses.
- **Nested cross-sections are refused**, not capped: a torus cut along its axis produces an annulus (outer ring + hole) and returns `nested-cut-rings`. Disjoint rings are supported (2 rings per piece on the torus x-cut).
- **Planar faces exactly on the cut plane** are assigned by face normal. When that leaves a side without a cross-section the split is refused (`no-cross-section`); the corpus deliberately keeps planes off exact faces.
- **Volume additivity alone is structural**: the two caps are exact duplicates with opposite winding, so V1+V2 would telescope even if the cap were geometrically wrong. The real oracles are the analytic box volumes and the independent ray-parity estimate.
- An open mesh can still produce a plausible *signed* volume (the baseline does: rel 1e-16), which is exactly why the baseline metric is enclosed volume via ray parity, plus boundary-edge count.
- The browser page was validated with `curl` (HTTP 200 + importmap) and by the baked-fingerprint parity path; no headless browser was run (forbidden in this environment).

## Layout

```
src/core.mjs           pure geometry: split + caps + ear clipping + manifold audit + fingerprint
main.js                three.js render/interaction, consumes core only
index.html             single entry, pinned importmap (three 0.170.0)
tools/gen-sample.mjs   deterministic corpus generator (9 meshes, 17 cuts, 54 baked planes)
baseline/naive.mjs     clip-without-cap baseline (self-contained)
bench/verify.mjs       assertions, exit code 0/1
bench/independent.mjs  independent ray-parity / edge-pairing oracle
bench/bench.mjs        timing -> bench/result.json
```

MIT licensed. No `node_modules`, no screenshots, no archives.
