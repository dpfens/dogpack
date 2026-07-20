// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/shaders/webgl/contrast.glsl
// Regenerate with `npm run build:shaders`.
const source = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_minVal;
uniform float u_maxVal;

void main() {
  float value = texture(u_image, v_texCoord).r;
  float range = u_maxVal - u_minVal;
  
  float result = range > 0.01 
    ? clamp((value - u_minVal) / range, 0.0, 1.0)
    : value;
    
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;
export default source;
//# sourceMappingURL=contrast.glsl.js.map