// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/gaussian_blur_h.glsl
// Regenerate with `npm run build:shaders`.
const source = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_kernel[33]; // Max kernel size 33
uniform int u_kernelSize;
uniform int u_radius;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = vec2(1.0 / u_resolution.x, 0.0);
  vec4 sum = vec4(0.0);
  
  for (int i = 0; i < u_kernelSize; i++) {
    vec2 offset = texel * float(i - u_radius);
    vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
    sum += texture(u_input, sampleCoord) * u_kernel[i];
  }
  
  fragColor = sum;
}`;
export default source;
//# sourceMappingURL=gaussian_blur_h.glsl.js.map