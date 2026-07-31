@group(0) @binding(0) var<uniform> params: Params;
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
  // .w is unused: the upstream gradient/structure-tensor pass no longer
  // precomputes magnitude in a separate finalize pass. It's derived
  // directly from the trace below instead — sqrt(E+G) == hypot(gx, gy)
  // for the single-channel case, and is the Di Zenzo-consistent combined
  // magnitude for the multichannel case (see gradient_structure_tensor.wgsl).
  let trace = e + g;
  let mag = sqrt(max(trace, 0.0));

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

  // Anisotropy: (lambda1-lambda2)/(lambda1+lambda2) = disc/trace. `disc`
  // is already computed above for the eigenvector; `trace` above for mag.
  let anisotropy = select(0.0, disc / trace, trace > 1e-8);

  // R=tx, G=ty, B=magnitude (for refinement weighting), A=anisotropy
  // (carried through tangent_refine unchanged, same as magnitude).
  outputBuf[idx] = vec4<f32>(tangent, mag, anisotropy);
}