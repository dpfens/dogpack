// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gradient_structure_tensor.wgsl
// Regenerate with `npm run build:shaders`.
const source = `// Fused Sobel gradient + structure-tensor accumulation.
//
// Replaces the old gradient.wgsl -> structure_tensor_accumulate.wgsl pair.
// Nothing downstream ever consumed the raw gradient (gx, gy) on its own —
// the only thing that read gradBuf was the tensor-accumulate pass, which
// immediately squared/multiplied it away — so materializing it as a
// separate full-image vec4<f32> buffer was a full extra write + read of
// image-sized data (and a whole dispatch) for no benefit. This shader
// computes the Sobel gradient and folds it directly into the running
// structure-tensor sum in one pass.
//
// Still an *accumulate* (read-modify-write add), exactly like the old
// structure_tensor_accumulate.wgsl: for Di Zenzo multichannel summation,
// this is dispatched once per input channel with accumBuf zeroed first
// (see encoder.clearBuffer() in webgpu.ts), and each channel's E/F/G is
// summed in rather than overwriting.
//
// .w (magnitude) is deliberately left untouched here, for the same reason
// as before: summing each channel's own sqrt(e+g) would be wrong since
// sqrt is nonlinear. Magnitude is now derived directly from the final
// accumulated trace inside tangent_extract.wgsl instead of a separate
// finalize-magnitude pass.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<f32>;
@group(0) @binding(2) var<storage, read_write> accumBuf: array<vec4<f32>>;

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

  // Structure tensor: E=gx^2, F=gx*gy, G=gy^2
  let e = gx * gx;
  let f = gx * gy;
  let g = gy * gy;

  let idx = u32(y * w + x);
  accumBuf[idx] = accumBuf[idx] + vec4<f32>(e, f, g, 0.0);
}
`;
export default source;
//# sourceMappingURL=gradient_structure_tensor.wgsl.js.map