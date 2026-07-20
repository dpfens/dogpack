"use strict";
// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: shaders/vertex-shader.wgsl
// Regenerate with `npm run build:shaders`.
Object.defineProperty(exports, "__esModule", { value: true });
const source = `/**
 * Vertex shader for WebGL2 - simple fullscreen quad
 */
#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
  
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;
exports.default = source;
//# sourceMappingURL=vertex-shader.wgsl.js.map