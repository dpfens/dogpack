"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/kuwahara.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Calculate mean and variance for a quadrant
vec2 quadrantStats(vec2 center, int startX, int endX, int startY, int endY) {
  float sum = 0.0;
  float sumSq = 0.0;
  float count = 0.0;
  
  for (int dy = startY; dy <= endY; dy++) {
    for (int dx = startX; dx <= endX; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float val = texture(u_image, center + offset).r;
      sum += val;
      sumSq += val * val;
      count += 1.0;
    }
  }
  
  float mean = sum / count;
  float variance = (sumSq / count) - (mean * mean);
  
  return vec2(mean, variance);
}

void main() {
  int r = u_radius;
  
  // Four quadrants: top-left, top-right, bottom-left, bottom-right
  vec2 q0 = quadrantStats(v_texCoord, -r, 0, -r, 0);
  vec2 q1 = quadrantStats(v_texCoord, 0, r, -r, 0);
  vec2 q2 = quadrantStats(v_texCoord, -r, 0, 0, r);
  vec2 q3 = quadrantStats(v_texCoord, 0, r, 0, r);
  
  // Find quadrant with minimum variance
  float minVar = q0.y;
  float result = q0.x;
  
  if (q1.y < minVar) { minVar = q1.y; result = q1.x; }
  if (q2.y < minVar) { minVar = q2.y; result = q2.x; }
  if (q3.y < minVar) { result = q3.x; }
  
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=kuwahara.glsl.js.map