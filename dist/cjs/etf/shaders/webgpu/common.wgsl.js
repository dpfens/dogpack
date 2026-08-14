"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/common.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `// common.wgsl
// Pipeline-overridable. real value supplied via
// GPUComputePipelineDescriptor.compute.constants (see makePipeline() in
// webgpu.ts). Declared once here since it's shared by every shader module.
override WORKGROUP_SIZE: u32 = 8u;

struct Params {
  width: u32,
  height: u32,
  radius: u32,
  kernelSize: u32,
};

fn clampIdx(x: i32, y: i32, w: i32, h: i32) -> u32 {
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return u32(cy * w + cx);
}`;
exports.default = source;
//# sourceMappingURL=common.wgsl.js.map