"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/shaders/webgl/bilateral.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_sigmaSpatial2;
uniform float u_sigmaRange2;
uniform int u_radius;

void main() {
  float centerValue = texture(u_image, v_texCoord).r;
  
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float neighborValue = texture(u_image, v_texCoord + offset).r;
      
      // Spatial weight
      float dist2 = float(dx * dx + dy * dy);
      float spatialWeight = exp(-dist2 / u_sigmaSpatial2);
      
      // Range weight
      float diff = neighborValue - centerValue;
      float rangeWeight = exp(-(diff * diff) / u_sigmaRange2);
      
      float weight = spatialWeight * rangeWeight;
      sum += neighborValue * weight;
      weightSum += weight;
    }
  }
  
  float result = weightSum > 0.0 ? sum / weightSum : centerValue;
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=bilateral.glsl.js.map