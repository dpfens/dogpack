// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/flow-guided/webgl2-vertex.glsl
// Regenerate with `npm run build:shaders`.
const source = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
  
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;
export default source;
//# sourceMappingURL=webgl2-vertex.glsl.js.map