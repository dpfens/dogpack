// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/gaussian.wgsl
// Regenerate with `npm run build:shaders`.
const source = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read> kernelWeights: array<f32>;
@group(0) @binding(3) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main_h(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let r = i32(params.radius);
  var sum: f32 = 0.0;
  for (var k = 0; k <= 2 * r; k = k + 1) {
    let sx = clamp(x + k - r, 0, i32(params.width) - 1);
    sum = sum + inputImage[y * i32(params.width) + sx] * kernelWeights[k];
  }
  outputImage[y * i32(params.width) + x] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main_v(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let r = i32(params.radius);
  var sum: f32 = 0.0;
  for (var k = 0; k <= 2 * r; k = k + 1) {
    let sy = clamp(y + k - r, 0, i32(params.height) - 1);
    sum = sum + inputImage[sy * i32(params.width) + x] * kernelWeights[k];
  }
  outputImage[y * i32(params.width) + x] = sum;
}
`;
export default source;
//# sourceMappingURL=gaussian.wgsl.js.map