"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/finalize_magnitude.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> tensorBuf: array<vec4<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let t = tensorBuf[idx];
  let mag = sqrt(max(t.x + t.z, 0.0));
  tensorBuf[idx] = vec4<f32>(t.x, t.y, t.z, mag);
}`;
exports.default = source;
//# sourceMappingURL=finalize_magnitude.wgsl.js.map