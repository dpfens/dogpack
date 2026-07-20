/**
 * Fragment shader for horizontal Gaussian blur pass (WebGL2)
 */
#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(float(offset) * texelSize.x, 0.0);
      result += texture(u_image, samplePos).r * u_kernel[i];
    }
    
    fragColor = vec4(result, result, result, 1.0);
  }
