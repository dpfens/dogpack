// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/finalize_magnitude.glsl
// Regenerate with `npm run build:shaders`.
const source = `#version 300 es
precision highp float;

uniform sampler2D u_tensor; // accumulated (summed) E, F, G in .rgb

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 tensor = texture(u_tensor, v_texCoord);
  float mag = sqrt(max(tensor.r + tensor.b, 0.0)); // sqrt(E + G), once, from the combined trace
  fragColor = vec4(tensor.r, tensor.g, tensor.b, mag);
}`;
export default source;
//# sourceMappingURL=finalize_magnitude.glsl.js.map