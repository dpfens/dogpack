"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/tangent_refine.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `override REFINE_TILE_DIM: u32 = WORKGROUP_SIZE + 4u; // fixed 5x5 (radius-2) footprint

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

var<workgroup> tile: array<vec4<f32>, REFINE_TILE_DIM * REFINE_TILE_DIM>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>
) {
  let w = i32(params.width);
  let h = i32(params.height);

  let localX = i32(lid.x);
  let localY = i32(lid.y);
  let wgOriginX = i32(wgid.x) * i32(WORKGROUP_SIZE);
  let wgOriginY = i32(wgid.y) * i32(WORKGROUP_SIZE);
  let tileDim = i32(REFINE_TILE_DIM);
  let tileCells = tileDim * tileDim;

  let flatLocal = localY * i32(WORKGROUP_SIZE) + localX;
  var loadIdx = flatLocal;
  loop {
    if (loadIdx >= tileCells) { break; }
    let ty = loadIdx / tileDim;
    let tx = loadIdx % tileDim;
    let sx = wgOriginX + tx - 2;
    let sy = wgOriginY + ty - 2;
    tile[loadIdx] = inputBuf[clampIdx(sx, sy, w, h)];
    loadIdx = loadIdx + i32(WORKGROUP_SIZE * WORKGROUP_SIZE);
  }

  workgroupBarrier();

  let x = wgOriginX + localX;
  let y = wgOriginY + localY;
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let current = tile[(localY + 2) * tileDim + (localX + 2)];
  let currentT = current.xy;

  var sum = vec2<f32>(0.0);
  var weightSum: f32 = 0.0;

  // 5x5 kernel (radius 2)
  for (var ky = -2; ky <= 2; ky = ky + 1) {
    for (var kx = -2; kx <= 2; kx = kx + 1) {
      let neighbor = tile[(localY + 2 + ky) * tileDim + (localX + 2 + kx)];
      let neighborT = neighbor.xy;
      let neighborMag = neighbor.z;

      // Direction weight with sign handling
      let dotVal = dot(currentT, neighborT);
      let signVal = select(-1.0, 1.0, dotVal >= 0.0);
      let dirWeight = abs(dotVal);
      let weight = neighborMag * dirWeight;

      sum = sum + signVal * neighborT * weight;
      weightSum = weightSum + weight;
    }
  }

  var refined = currentT;
  if (weightSum > 1e-10) {
    refined = sum / weightSum;
    let len = length(refined);
    if (len > 1e-10) {
      refined = refined / len;
    }
  }

  outputBuf[idx] = vec4<f32>(refined, current.z, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=tangent_refine.wgsl.js.map