#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeY;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    float offset = float(dy) * u_texelSizeY;
    float value = texture(u_image, v_texCoord + vec2(0.0, offset)).r;
    
    float weight = exp(-float(dy * dy) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}