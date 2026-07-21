"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/tangent_extract.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `#version 300 es
precision highp float;

uniform sampler2D u_tensor;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 tensor = texture(u_tensor, v_texCoord);
  float e = tensor.r;
  float f = tensor.g;
  float g = tensor.b;
  float mag = tensor.a;
    
  // Compute eigenvector for smallest eigenvalue
  float diff = e - g;
  float disc = sqrt(diff * diff + 4.0 * f * f);
  
  vec2 tangent;
  
  if (abs(f) > 1e-10) {
    float lambda1 = (e + g - disc) * 0.5;
    tangent = vec2(lambda1 - g, f);
  } else if (e < g) {
    tangent = vec2(1.0, 0.0);
  } else {
    tangent = vec2(0.0, 1.0);
  }
  
  // Normalize
  float len = length(tangent);
  if (len > 1e-10) {
    tangent /= len;
  }
  
  // Output: R=tx, G=ty, B=magnitude (for refinement weighting)
  fragColor = vec4(tangent, mag, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=tangent_extract.glsl.js.map