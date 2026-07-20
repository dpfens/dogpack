"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/shaders/webgpu/stretch.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `struct Params {
  width: u32,
  height: u32,
  minVal: f32,
  range: f32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let idx = y * i32(params.width) + x;
  let v = (inputImage[idx] - params.minVal) / params.range;
  outputImage[idx] = clamp(v, 0.0, 1.0);
}
`;
exports.default = source;
//# sourceMappingURL=stretch.wgsl.js.map