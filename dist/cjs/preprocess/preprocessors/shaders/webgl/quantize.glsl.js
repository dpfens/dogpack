"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/quantize.glsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_levels;

void main() {
  float value = texture(u_image, v_texCoord).r;
  float step = 1.0 / (u_levels - 1.0);
  float result = floor(value / step + 0.5) * step;
  fragColor = vec4(clamp(result, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;
exports.default = source;
//# sourceMappingURL=quantize.glsl.js.map