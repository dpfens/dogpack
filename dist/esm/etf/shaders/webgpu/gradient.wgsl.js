// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gradient.wgsl
// Regenerate with `npm run build:shaders`.
const source = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  // Sobel operator
  let p00 = inputBuf[clampIdx(x - 1, y - 1, w, h)];
  let p10 = inputBuf[clampIdx(x,     y - 1, w, h)];
  let p20 = inputBuf[clampIdx(x + 1, y - 1, w, h)];
  let p01 = inputBuf[clampIdx(x - 1, y,     w, h)];
  let p21 = inputBuf[clampIdx(x + 1, y,     w, h)];
  let p02 = inputBuf[clampIdx(x - 1, y + 1, w, h)];
  let p12 = inputBuf[clampIdx(x,     y + 1, w, h)];
  let p22 = inputBuf[clampIdx(x + 1, y + 1, w, h)];

  let gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  let gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;

  // R=gx, G=gy — B/A unused downstream (magnitude is re-derived from the
  // structure tensor's trace after channel accumulation, not carried
  // through from here; see FINALIZE_MAGNITUDE_SHADER).
  outputBuf[u32(y * w + x)] = vec4<f32>(gx, gy, 0.0, 1.0);
}`;
export default source;
//# sourceMappingURL=gradient.wgsl.js.map