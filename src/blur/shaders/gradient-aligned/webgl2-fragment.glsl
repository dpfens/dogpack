#version 300 es
precision highp float;

#define MAX_SAMPLES ${MAX_SAMPLES}

uniform sampler2D u_input;
uniform sampler2D u_flowDir;
uniform vec2 u_resolution;
uniform int u_halfSamples;
uniform float u_stepSize;
uniform float u_weights[MAX_SAMPLES];

out vec4 outColor;

// Manual bilinear + clamp-to-edge, matching utils/getPixelBilinear exactly.
// We do this ourselves (via texelFetch) rather than relying on hardware
// LINEAR filtering, because WebGL2 doesn't guarantee linear filtering for
// 32-bit float textures without the OES_texture_float_linear extension.
float fetchClamped(sampler2D tex, int x, int y, int w, int h) {
  int cx = clamp(x, 0, w - 1);
  int cy = clamp(y, 0, h - 1);
  return texelFetch(tex, ivec2(cx, cy), 0).r;
}

float sampleBilinear(sampler2D tex, float x, float y, int w, int h) {
  int x0 = int(floor(x));
  int y0 = int(floor(y));
  int x1 = x0 + 1;
  int y1 = y0 + 1;
  float fx = x - float(x0);
  float fy = y - float(y0);
  float v00 = fetchClamped(tex, x0, y0, w, h);
  float v10 = fetchClamped(tex, x1, y0, w, h);
  float v01 = fetchClamped(tex, x0, y1, w, h);
  float v11 = fetchClamped(tex, x1, y1, w, h);
  return v00 * (1.0 - fx) * (1.0 - fy) + v10 * fx * (1.0 - fy)
       + v01 * (1.0 - fx) * fy + v11 * fx * fy;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int w = int(u_resolution.x);
  int h = int(u_resolution.y);
  float px0 = float(px.x);
  float py0 = float(px.y);

  // Flow direction is only ever sampled at integer pixel centers on the
  // CPU path (no bilinear there), so texelFetch (nearest) is correct here.
  vec2 dir = texelFetch(u_flowDir, px, 0).rg;

  int center = u_halfSamples;
  float sum = sampleBilinear(u_input, px0, py0, w, h) * u_weights[center];
  float weightSum = u_weights[center];

  // Positive gradient direction
  for (int i = 1; i <= MAX_SAMPLES; i++) {
    if (i > u_halfSamples) break;
    float fx = px0 + dir.x * u_stepSize * float(i);
    float fy = py0 + dir.y * u_stepSize * float(i);
    if (fx < -0.5 || fx > u_resolution.x - 0.5 || fy < -0.5 || fy > u_resolution.y - 0.5) {
      break;
    }
    float wgt = u_weights[center + i];
    sum += sampleBilinear(u_input, fx, fy, w, h) * wgt;
    weightSum += wgt;
  }

  // Negative gradient direction
  for (int i = 1; i <= MAX_SAMPLES; i++) {
    if (i > u_halfSamples) break;
    float fx = px0 - dir.x * u_stepSize * float(i);
    float fy = py0 - dir.y * u_stepSize * float(i);
    if (fx < -0.5 || fx > u_resolution.x - 0.5 || fy < -0.5 || fy > u_resolution.y - 0.5) {
      break;
    }
    float wgt = u_weights[center - i];
    sum += sampleBilinear(u_input, fx, fy, w, h) * wgt;
    weightSum += wgt;
  }

  float result = weightSum > 0.0 ? sum / weightSum : 0.0;
  outColor = vec4(result, 0.0, 0.0, 1.0);
}