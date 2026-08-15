// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/isotropic/shaders/webgpu-horizontal-blur.wgsl
// Regenerate with `npm run build:shaders`.
const source = `struct Params {
  width: u32,
  height: u32,
  kernelSize: u32,
  _pad: u32,
}

@group(0) @binding(0)
var<uniform> params: Params;

@group(0) @binding(1)
var<storage, read> kernel: array<f32>;

@group(0) @binding(2)
var<storage, read> input: array<f32>;

@group(0) @binding(3)
var<storage, read_write> output: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }
  
  let halfSize = i32(params.kernelSize) / 2;
  var sum = 0.0;
  
  for (var k = 0; k < i32(params.kernelSize); k = k + 1) {
    let sampleX = i32(x) + k - halfSize;
    let clampedX = clamp(sampleX, 0, i32(params.width) - 1);
    let sampleIdx = u32(clampedX) + y * params.width;
    sum = sum + input[sampleIdx] * kernel[u32(k)];
  }
  
  output[x + y * params.width] = sum;
}`;
export default source;
//# sourceMappingURL=webgpu-horizontal-blur.wgsl.js.map