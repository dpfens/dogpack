"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gaussian_blur.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kernelBuf: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurH(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);
  var sum = vec4<f32>(0.0);

  for (var i = 0; i < kernelSize; i = i + 1) {
    let sx = x + (i - radius);
    sum = sum + inputBuf[clampIdx(sx, y, w, h)] * kernelBuf[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurV(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);
  var sum = vec4<f32>(0.0);

  for (var i = 0; i < kernelSize; i = i + 1) {
    let sy = y + (i - radius);
    sum = sum + inputBuf[clampIdx(x, sy, w, h)] * kernelBuf[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}`;
exports.default = source;
//# sourceMappingURL=gaussian_blur.wgsl.js.map