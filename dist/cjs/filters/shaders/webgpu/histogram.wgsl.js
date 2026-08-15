"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/histogram.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `struct Params {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> histogram: array<atomic<u32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let v = clamp(inputImage[y * i32(params.width) + x], 0.0, 1.0);
  let bin = u32(v * 255.0 + 0.5);
  atomicAdd(&histogram[min(bin, 255u)], 1u);
}
`;
exports.default = source;
//# sourceMappingURL=histogram.wgsl.js.map