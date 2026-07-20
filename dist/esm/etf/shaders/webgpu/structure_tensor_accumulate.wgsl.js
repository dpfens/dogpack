// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/structure_tensor_accumulate.wgsl
// Regenerate with `npm run build:shaders`.
const source = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gradBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> accumBuf: array<vec4<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let grad = gradBuf[idx];
  let gx = grad.x;
  let gy = grad.y;

  // Structure tensor: E=gx^2, F=gx*gy, G=gy^2
  let e = gx * gx;
  let f = gx * gy;
  let g = gy * gy;

  accumBuf[idx] = accumBuf[idx] + vec4<f32>(e, f, g, 0.0);
}`;
export default source;
//# sourceMappingURL=structure_tensor_accumulate.wgsl.js.map