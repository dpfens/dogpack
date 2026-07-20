"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/shaders/webgpu/bilateral.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  rowOffset: u32,
  sigmaSpatial2: f32,
  sigmaRange2: f32,
  _pad1: f32,
  _pad2: f32,
};

// Pipeline-overridable — real value supplied via
// GPUComputePipelineDescriptor.compute.constants (see getPipeline() in
// webgpu.ts, which injects it for every pipeline by default).
override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;
@group(0) @binding(3) var<storage, read> spatialWeights: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  // gid.y is relative to the current chunk; rowOffset shifts it back into
  // the coordinate space of the full image.
  let y = i32(gid.y) + i32(params.rowOffset);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);
  let center = samplePixel(x, y);

  var sum: f32 = 0.0;
  var weightSum: f32 = 0.0;
  var idx: u32 = 0u;

  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      let neighbor = samplePixel(x + dx, y + dy);
      let diff = neighbor - center;
      let rangeWeight = exp(-(diff * diff) / params.sigmaRange2);
      let weight = spatialWeights[idx] * rangeWeight;
      sum = sum + neighbor * weight;
      weightSum = weightSum + weight;
      idx = idx + 1u;
    }
  }

  outputImage[y * i32(params.width) + x] = select(center, sum / weightSum, weightSum > 0.0);
}
`;
exports.default = source;
//# sourceMappingURL=bilateral.wgsl.js.map