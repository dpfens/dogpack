"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/gradient-aligned/webgpu-fragment.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `struct Params {
  width: u32,
  height: u32,
  halfSamples: u32,
  stepSize: f32,
  rowOffset: u32,   // first global row this dispatch is responsible for
  tileHeight: u32,  // number of rows in this tile's output buffer
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
// max samples must match MAX_SAMPLES
@group(0) @binding(1) var<storage, read> weights: array<f32, 256>;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var flowTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;

fn fetchClamped(tex: texture_2d<f32>, x: i32, y: i32, w: i32, h: i32) -> f32 {
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return textureLoad(tex, vec2<i32>(cx, cy), 0).r;
}

fn sampleBilinear(tex: texture_2d<f32>, x: f32, y: f32, w: i32, h: i32) -> f32 {
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let fx = x - f32(x0);
  let fy = y - f32(y0);
  let v00 = fetchClamped(tex, x0, y0, w, h);
  let v10 = fetchClamped(tex, x1, y0, w, h);
  let v01 = fetchClamped(tex, x0, y1, w, h);
  let v11 = fetchClamped(tex, x1, y1, w, h);
  return v00 * (1.0 - fx) * (1.0 - fy) + v10 * fx * (1.0 - fy)
       + v01 * (1.0 - fx) * fy + v11 * fx * fy;
}

// workgroup_sizes must match WORKGROUP_SIZE
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let localY = i32(gid.y);
  // Bounds-check against this tile's height (buffer is sized per-tile,
  // not per-image) before doing anything else.
  if (i32(gid.x) >= w || localY >= i32(params.tileHeight)) {
    return;
  }
  let globalY = localY + i32(params.rowOffset);
  if (globalY >= h) {
    return;
  }

  let px0 = f32(gid.x);
  let py0 = f32(globalY);
  // Flow direction only ever sampled at integer pixel centers on the CPU
  // path, so nearest-load (no interpolation) is correct here.
  let dir = textureLoad(flowTex, vec2<i32>(i32(gid.x), globalY), 0).rg;

  let center = i32(params.halfSamples);
  var sum = sampleBilinear(inputTex, px0, py0, w, h) * weights[center];
  var weightSum = weights[center];

  var i: i32 = 1;
  loop {
    if (i > i32(params.halfSamples)) { break; }
    let fx = px0 + dir.x * params.stepSize * f32(i);
    let fy = py0 + dir.y * params.stepSize * f32(i);
    if (fx < -0.5 || fx > f32(w) - 0.5 || fy < -0.5 || fy > f32(h) - 0.5) { break; }
    let wgt = weights[center + i];
    sum = sum + sampleBilinear(inputTex, fx, fy, w, h) * wgt;
    weightSum = weightSum + wgt;
    i = i + 1;
  }

  i = 1;
  loop {
    if (i > i32(params.halfSamples)) { break; }
    let fx = px0 - dir.x * params.stepSize * f32(i);
    let fy = py0 - dir.y * params.stepSize * f32(i);
    if (fx < -0.5 || fx > f32(w) - 0.5 || fy < -0.5 || fy > f32(h) - 0.5) { break; }
    let wgt = weights[center - i];
    sum = sum + sampleBilinear(inputTex, fx, fy, w, h) * wgt;
    weightSum = weightSum + wgt;
    i = i + 1;
  }

  let result = select(0.0, sum / weightSum, weightSum > 0.0);
  output[u32(localY) * params.width + gid.x] = result;
}`;
exports.default = source;
//# sourceMappingURL=webgpu-fragment.wgsl.js.map