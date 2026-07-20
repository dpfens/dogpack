// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/tangent_extract.wgsl
// Regenerate with `npm run build:shaders`.
const source = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> tensorBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let tensor = tensorBuf[idx];
  let e = tensor.x;
  let f = tensor.y;
  let g = tensor.z;
  let mag = tensor.w;

  // Eigenvector for smallest eigenvalue
  let diff = e - g;
  let disc = sqrt(diff * diff + 4.0 * f * f);

  var tangent = vec2<f32>(0.0, 1.0);

  if (abs(f) > 1e-10) {
    let lambda1 = (e + g - disc) * 0.5;
    tangent = vec2<f32>(lambda1 - g, f);
  } else if (e < g) {
    tangent = vec2<f32>(1.0, 0.0);
  } else {
    tangent = vec2<f32>(0.0, 1.0);
  }

  let len = length(tangent);
  if (len > 1e-10) {
    tangent = tangent / len;
  }

  // R=tx, G=ty, B=magnitude (for refinement weighting)
  outputBuf[idx] = vec4<f32>(tangent, mag, 1.0);
}`;
export default source;
//# sourceMappingURL=tangent_extract.wgsl.js.map