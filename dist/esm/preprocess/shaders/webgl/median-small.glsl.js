// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/shaders/webgl/median-small.glsl
// Regenerate with `npm run build:shaders`.
const source = `// For small radius, use direct sorting approach (more accurate)
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Partial sort network for finding median of small kernels
// This is exact for radius 1-2 (3x3 to 5x5 kernels)

void swap(inout float a, inout float b) {
  float t = min(a, b);
  b = max(a, b);
  a = t;
}

void main() {
  // Collect all values
  float values[25]; // Max 5x5
  int count = 0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      values[count] = texture(u_image, v_texCoord + offset).r;
      count++;
    }
  }
  
  // Partial bubble sort to find median
  int medianIdx = count / 2;
  
  for (int i = 0; i <= medianIdx; i++) {
    for (int j = i + 1; j < count; j++) {
      swap(values[i], values[j]);
    }
  }
  
  fragColor = vec4(values[medianIdx], 0.0, 0.0, 1.0);
}`;
export default source;
//# sourceMappingURL=median-small.glsl.js.map