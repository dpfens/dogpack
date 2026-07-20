// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/flow-guided/webgl2-flow-blur.glsl
// Regenerate with `npm run build:shaders`.
const source = `/**
 * Fragment shader for flow-guided blur (WebGL2)
 * Uses line integral convolution along edge tangent directions
 */
#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform sampler2D u_flowField;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    int halfSize = u_kernelSize / 2;
    
    vec2 flow = texture(u_flowField, v_texCoord).rg * 2.0 - 1.0;
    
    float result = 0.0;
    float weightSum = 0.0;
    
    // Sample along positive flow direction
    vec2 pos = v_texCoord;
    for (int i = 0; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize + i;
      if (idx >= u_kernelSize) break;
      
      result += texture(u_image, pos).r * u_kernel[idx];
      weightSum += u_kernel[idx];
      
      vec2 localFlow = texture(u_flowField, pos).rg * 2.0 - 1.0;
      pos += localFlow * texelSize;
    }
    
    // Sample along negative flow direction
    pos = v_texCoord;
    for (int i = 1; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize - i;
      if (idx < 0) break;
      
      vec2 localFlow = texture(u_flowField, pos).rg * 2.0 - 1.0;
      pos -= localFlow * texelSize;
      
      result += texture(u_image, pos).r * u_kernel[idx];
      weightSum += u_kernel[idx];
    }
    
    result = weightSum > 0.0 ? result / weightSum : 0.0;
    fragColor = vec4(result, result, result, 1.0);
  }
`;
export default source;
//# sourceMappingURL=webgl2-flow-blur.glsl.js.map