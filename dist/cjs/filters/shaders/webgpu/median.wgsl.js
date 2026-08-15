"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/median.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

// N (the per-pixel neighborhood size, (2*radius+1)^2) sizes a plain
// function-local \`var\`, not a \`var<workgroup>\` one — WGSL's override-as-
// array-size exception only covers the latter, so N can't become an
// \`override\`. It has to stay a real \`const\`, resolved at shader-module
// creation. That means it genuinely can't be fixed at build time; a new
// module is compiled per distinct radius, same as before. __N__ is
// substituted at runtime in medianShaderSource() (webgpu.ts) — the one
// remaining spot in this codebase that still needs string templating,
// and for a language-level reason rather than convenience.
const N: u32 = __N__u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);
  var vals: array<f32, N>;
  var idx: u32 = 0u;
  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      vals[idx] = samplePixel(x + dx, y + dy);
      idx = idx + 1u;
    }
  }

  // Insertion sort: O(n^2), fine for the small neighborhoods used here
  // (n = (2*radius+1)^2, e.g. 25 at radius 2).
  for (var i = 1u; i < N; i = i + 1u) {
    let key = vals[i];
    var j = i;
    while (j > 0u && vals[j - 1u] > key) {
      vals[j] = vals[j - 1u];
      j = j - 1u;
    }
    vals[j] = key;
  }

  outputImage[y * i32(params.width) + x] = vals[N / 2u];
}
`;
exports.default = source;
//# sourceMappingURL=median.wgsl.js.map