"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gaussian_blur_tiled.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `override TILE_RADIUS_CAP: u32 = 32u;
override TILE_WIDTH: u32 = WORKGROUP_SIZE + 2u * TILE_RADIUS_CAP;
override KERNEL_SHARED_SIZE: u32 = 2u * TILE_RADIUS_CAP + 1u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kernelBuf: array<f32>;

// Sized for the worst-case radius this tiled path supports (TILE_RADIUS_CAP);
// actual radius at dispatch time is always <= that, so only a prefix of
// these arrays is used per call.
var<workgroup> tileRow: array<vec4<f32>, TILE_WIDTH * WORKGROUP_SIZE>;
var<workgroup> kernelShared: array<f32, KERNEL_SHARED_SIZE>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurHTiled(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>
) {
  let w = i32(params.width);
  let h = i32(params.height);
  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);

  let localX = i32(lid.x);
  let localY = i32(lid.y);
  let flatLocal = localY * i32(WORKGROUP_SIZE) + localX;
  let wgOriginX = i32(wgid.x) * i32(WORKGROUP_SIZE);
  let wgOriginY = i32(wgid.y) * i32(WORKGROUP_SIZE);
  let tileWidth = i32(WORKGROUP_SIZE) + 2 * radius;

  var loadIdx = flatLocal;
  loop {
    if (loadIdx >= kernelSize) { break; }
    kernelShared[loadIdx] = kernelBuf[loadIdx];
    loadIdx = loadIdx + i32(WORKGROUP_SIZE * WORKGROUP_SIZE);
  }

  let y = wgOriginY + localY;
  var col = localX;
  loop {
    if (col >= tileWidth) { break; }
    let sx = wgOriginX + col - radius;
    tileRow[localY * i32(TILE_WIDTH) + col] = inputBuf[clampIdx(sx, y, w, h)];
    col = col + i32(WORKGROUP_SIZE);
  }

  workgroupBarrier();

  let x = wgOriginX + localX;
  if (x >= w || y >= h) { return; }

  var sum = vec4<f32>(0.0);
  for (var i = 0; i < kernelSize; i = i + 1) {
    sum = sum + tileRow[localY * i32(TILE_WIDTH) + localX + i] * kernelShared[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurVTiled(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>
) {
  let w = i32(params.width);
  let h = i32(params.height);
  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);

  let localX = i32(lid.x);
  let localY = i32(lid.y);
  let flatLocal = localY * i32(WORKGROUP_SIZE) + localX;
  let wgOriginX = i32(wgid.x) * i32(WORKGROUP_SIZE);
  let wgOriginY = i32(wgid.y) * i32(WORKGROUP_SIZE);
  let tileHeight = i32(WORKGROUP_SIZE) + 2 * radius;

  var loadIdx = flatLocal;
  loop {
    if (loadIdx >= kernelSize) { break; }
    kernelShared[loadIdx] = kernelBuf[loadIdx];
    loadIdx = loadIdx + i32(WORKGROUP_SIZE * WORKGROUP_SIZE);
  }

  let x = wgOriginX + localX;
  var row = localY;
  loop {
    if (row >= tileHeight) { break; }
    let sy = wgOriginY + row - radius;
    tileRow[row * i32(WORKGROUP_SIZE) + localX] = inputBuf[clampIdx(x, sy, w, h)];
    row = row + i32(WORKGROUP_SIZE);
  }

  workgroupBarrier();

  let y = wgOriginY + localY;
  if (x >= w || y >= h) { return; }

  var sum = vec4<f32>(0.0);
  for (var i = 0; i < kernelSize; i = i + 1) {
    sum = sum + tileRow[(localY + i) * i32(WORKGROUP_SIZE) + localX] * kernelShared[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}`;
exports.default = source;
//# sourceMappingURL=gaussian_blur_tiled.wgsl.js.map