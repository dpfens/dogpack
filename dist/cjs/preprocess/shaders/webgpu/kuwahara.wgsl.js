"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/shaders/webgpu/kuwahara.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

fn quadrantStats(x: i32, y: i32, x0: i32, x1: i32, y0: i32, y1: i32) -> vec2<f32> {
  var sum: f32 = 0.0;
  var sumSq: f32 = 0.0;
  var count: f32 = 0.0;
  for (var dy = y0; dy <= y1; dy = dy + 1) {
    for (var dx = x0; dx <= x1; dx = dx + 1) {
      let v = samplePixel(x + dx, y + dy);
      sum = sum + v;
      sumSq = sumSq + v * v;
      count = count + 1.0;
    }
  }
  let mean = sum / count;
  let variance = (sumSq / count) - (mean * mean);
  return vec2<f32>(mean, variance);
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);

  // Four quadrants: top-left, top-right, bottom-left, bottom-right.
  let q0 = quadrantStats(x, y, -r, 0, -r, 0);
  let q1 = quadrantStats(x, y, 0, r, -r, 0);
  let q2 = quadrantStats(x, y, -r, 0, 0, r);
  let q3 = quadrantStats(x, y, 0, r, 0, r);

  var bestMean = q0.x;
  var minVariance = q0.y;

  if (q1.y < minVariance) { minVariance = q1.y; bestMean = q1.x; }
  if (q2.y < minVariance) { minVariance = q2.y; bestMean = q2.x; }
  if (q3.y < minVariance) { minVariance = q3.y; bestMean = q3.x; }

  outputImage[y * i32(params.width) + x] = bestMean;
}
`;
exports.default = source;
//# sourceMappingURL=kuwahara.wgsl.js.map