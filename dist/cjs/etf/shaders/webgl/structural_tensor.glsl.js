"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/structural_tensor.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  // Sobel operator
  float p00 = texture(u_input, v_texCoord + vec2(-1, -1) * texel).r;
  float p10 = texture(u_input, v_texCoord + vec2( 0, -1) * texel).r;
  float p20 = texture(u_input, v_texCoord + vec2( 1, -1) * texel).r;
  float p01 = texture(u_input, v_texCoord + vec2(-1,  0) * texel).r;
  float p21 = texture(u_input, v_texCoord + vec2( 1,  0) * texel).r;
  float p02 = texture(u_input, v_texCoord + vec2(-1,  1) * texel).r;
  float p12 = texture(u_input, v_texCoord + vec2( 0,  1) * texel).r;
  float p22 = texture(u_input, v_texCoord + vec2( 1,  1) * texel).r;
  
  float gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  float gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;

  // Structure tensor components: E = Ix^2, F = Ix*Iy, G = Iy^2.
  float e = gx * gx;
  float f = gx * gy;
  float g = gy * gy;

  // Magnitude deliberately NOT computed here — see finalize_magnitude.glsl.
  fragColor = vec4(e, f, g, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=structural_tensor.glsl.js.map