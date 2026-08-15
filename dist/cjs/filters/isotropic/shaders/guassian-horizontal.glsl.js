"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/isotropic/shaders/guassian-horizontal.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeX;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dx = -u_radius; dx <= u_radius; dx++) {
    float offset = float(dx) * u_texelSizeX;
    float value = texture(u_image, v_texCoord + vec2(offset, 0.0)).r;
    
    float weight = exp(-float(dx * dx) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=guassian-horizontal.glsl.js.map