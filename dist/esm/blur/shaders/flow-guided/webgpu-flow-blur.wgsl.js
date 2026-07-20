// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/flow-guided/webgpu-flow-blur.wgsl
// Regenerate with `npm run build:shaders`.
const source = `/**
 * WebGPU compute shader for flow-guided blur
 */
struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    rowOffset: u32,   // first global row this dispatch is responsible for
    tileHeight: u32,  // number of rows in this tile's output buffer
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var inputTex: texture_2d<f32>;
  @group(0) @binding(3) var flowTex: texture_2d<f32>;
  @group(0) @binding(4) var<storage, read_write> output: array<f32>;
  
  fn fetchClamped(x: i32, y: i32, w: i32, h: i32) -> f32 {
    let cx = clamp(x, 0, w - 1);
    let cy = clamp(y, 0, h - 1);
    return textureLoad(inputTex, vec2<i32>(cx, cy), 0).r;
  }
  
  fn sampleBilinear(x: f32, y: f32, w: i32, h: i32) -> f32 {
    let x0 = i32(floor(x));
    let y0 = i32(floor(y));
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    
    let fx = x - f32(x0);
    let fy = y - f32(y0);
    
    let v00 = fetchClamped(x0, y0, w, h);
    let v10 = fetchClamped(x1, y0, w, h);
    let v01 = fetchClamped(x0, y1, w, h);
    let v11 = fetchClamped(x1, y1, w, h);
    
    return v00 * (1.0 - fx) * (1.0 - fy) +
           v10 * fx * (1.0 - fy) +
           v01 * (1.0 - fx) * fy +
           v11 * fx * fy;
  }
  
  fn getTangent(x: f32, y: f32, w: i32, h: i32) -> vec2<f32> {
    let cx = clamp(i32(round(x)), 0, w - 1);
    let cy = clamp(i32(round(y)), 0, h - 1);
    return textureLoad(flowTex, vec2<i32>(cx, cy), 0).rg;
  }
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let w = i32(params.width);
    let h = i32(params.height);
    let x = i32(global_id.x);
    let localY = i32(global_id.y);
    
    // Bounds-check against this tile's height (output buffer is sized
    // per-tile, not per-image) before the per-image height check.
    if (x >= w || localY >= i32(params.tileHeight)) {
      return;
    }
    let globalY = localY + i32(params.rowOffset);
    if (globalY >= h) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    var weightSum: f32 = 0.0;
    
    // Sample in positive flow direction
    var px: f32 = f32(x);
    var py: f32 = f32(globalY);
    for (var i: i32 = halfKernel; i < i32(params.kernelSize); i++) {
      sum += sampleBilinear(px, py, w, h) * kernel[i];
      weightSum += kernel[i];
      
      let tangent = getTangent(px, py, w, h);
      px += tangent.x;
      py += tangent.y;
    }
    
    // Sample in negative flow direction
    px = f32(x);
    py = f32(globalY);
    for (var i: i32 = halfKernel - 1; i >= 0; i--) {
      let tangent = getTangent(px, py, w, h);
      px -= tangent.x;
      py -= tangent.y;
      
      sum += sampleBilinear(px, py, w, h) * kernel[i];
      weightSum += kernel[i];
    }
    
    if (weightSum > 0.0) {
      output[u32(localY) * params.width + u32(x)] = sum / weightSum;
    } else {
      output[u32(localY) * params.width + u32(x)] = 0.0;
    }
  }
`;
export default source;
//# sourceMappingURL=webgpu-flow-blur.wgsl.js.map