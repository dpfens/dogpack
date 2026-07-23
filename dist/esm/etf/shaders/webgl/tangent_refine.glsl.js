// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/tangent_refine.glsl
// Regenerate with `npm run build:shaders`.
const source = `#version 300 es
precision highp float;

uniform sampler2D u_tangents;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  vec4 current = texture(u_tangents, v_texCoord);
  vec2 currentT = current.rg;
  float currentMag = current.b;
  
  vec2 sum = vec2(0.0);
  float weightSum = 0.0;
  
  // 5x5 kernel (radius 2)
  for (int ky = -2; ky <= 2; ky++) {
    for (int kx = -2; kx <= 2; kx++) {
      vec2 offset = vec2(float(kx), float(ky)) * texel;
      vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
      
      vec4 neighbor = texture(u_tangents, sampleCoord);
      vec2 neighborT = neighbor.rg;
      float neighborMag = neighbor.b;
      
      // Direction weight with sign handling
      float dot_val = dot(currentT, neighborT);
      float sign_val = dot_val >= 0.0 ? 1.0 : -1.0;
      float dirWeight = abs(dot_val);
      
      float weight = neighborMag * dirWeight;
      
      sum += sign_val * neighborT * weight;
      weightSum += weight;
    }
  }
  
  vec2 refined = currentT;
  if (weightSum > 1e-10) {
    refined = sum / weightSum;
    float len = length(refined);
    if (len > 1e-10) {
      refined /= len;
    }
  }
  
  // .b (magnitude) and .a (anisotropy) are both static per-pixel scalars
  // derived from the blurred tensor before refinement started — refine
  // only ever touches the tangent direction, so both are carried through
  // unchanged across iterations.
  fragColor = vec4(refined, current.b, current.a);
}`;
export default source;
//# sourceMappingURL=tangent_refine.glsl.js.map