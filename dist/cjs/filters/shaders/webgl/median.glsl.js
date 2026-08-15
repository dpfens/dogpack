"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/median.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `// True median requires sorting which isn't efficient in shaders.
// We use a weighted percentile approximation that's very close to median.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Histogram-based median approximation
// We use 32 bins for speed while maintaining accuracy
#define NUM_BINS 32

void main() {
  float bins[NUM_BINS];
  for (int i = 0; i < NUM_BINS; i++) bins[i] = 0.0;
  
  float totalWeight = 0.0;
  int kernelSize = (2 * u_radius + 1) * (2 * u_radius + 1);
  
  // Build histogram
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float value = texture(u_image, v_texCoord + offset).r;
      
      // Map value to bin
      int binIdx = int(clamp(value * float(NUM_BINS - 1), 0.0, float(NUM_BINS - 1)));
      bins[binIdx] += 1.0;
      totalWeight += 1.0;
    }
  }
  
  // Find median (50th percentile)
  float targetWeight = totalWeight * 0.5;
  float cumWeight = 0.0;
  float median = 0.5;
  
  for (int i = 0; i < NUM_BINS; i++) {
    cumWeight += bins[i];
    if (cumWeight >= targetWeight) {
      median = (float(i) + 0.5) / float(NUM_BINS);
      break;
    }
  }
  
  fragColor = vec4(median, 0.0, 0.0, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=median.glsl.js.map