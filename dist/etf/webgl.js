/**
 * WebGL-accelerated Edge Tangent Flow computation
 *
 * Provides significant speedup over CPU implementation by running
 * gradient computation, structure tensor building/smoothing, and
 * tangent extraction on the GPU.
 */
import { DEFAULT_ETF_CONFIG } from '../types.js';
import { createGrayscaleImage } from '../utils.js';
/**
 * Shader source code
 */
const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_texCoord;

void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
const GRADIENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  // Sobel operator
  float p00 = texture(u_input, v_texCoord + vec2(-1, -1) * texel).r;
  float p10 = texture(u_input, v_texCoord + vec2( 0, -1) * texel).r;
  float p20 = texture(u_input, v_texCoord + vec2( 1, -1) * texel).r;
  float p01 = texture(u_input, v_texCoord + vec2(-1,  0) * texel).r;
  float p21 = texture(u_input, v_texCoord + vec2( 1,  0) * texel).r;
  float p02 = texture(u_input, v_texCoord + vec2(-1,  1) * texel).r;
  float p12 = texture(u_input, v_texCoord + vec2( 0,  1) * texel).r;
  float p22 = texture(u_input, v_texCoord + vec2( 1,  1) * texel).r;
  
  float gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  float gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;
  float mag = length(vec2(gx, gy));
  
  // Output: R=gx, G=gy, B=magnitude
  fragColor = vec4(gx, gy, mag, 1.0);
}
`;
const STRUCTURE_TENSOR_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_gradients;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 grad = texture(u_gradients, v_texCoord);
  float gx = grad.r;
  float gy = grad.g;
  
  // Structure tensor: E=gx², F=gx*gy, G=gy²
  float e = gx * gx;
  float f = gx * gy;
  float g = gy * gy;
  
  // Output: R=E, G=F, B=G, A=magnitude (passed through)
  fragColor = vec4(e, f, g, grad.b);
}
`;
const GAUSSIAN_BLUR_H_SHADER = `#version 300 es
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
}
`;
const GAUSSIAN_BLUR_V_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_kernel[33];
uniform int u_kernelSize;
uniform int u_radius;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = vec2(0.0, 1.0 / u_resolution.y);
  vec4 sum = vec4(0.0);
  
  for (int i = 0; i < u_kernelSize; i++) {
    vec2 offset = texel * float(i - u_radius);
    vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
    sum += texture(u_input, sampleCoord) * u_kernel[i];
  }
  
  fragColor = sum;
}
`;
const TANGENT_EXTRACT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_tensor;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 tensor = texture(u_tensor, v_texCoord);
  float e = tensor.r;
  float f = tensor.g;
  float g = tensor.b;
  float mag = tensor.a;
  
  // Compute eigenvector for smallest eigenvalue
  float diff = e - g;
  float disc = sqrt(diff * diff + 4.0 * f * f);
  
  vec2 tangent;
  
  if (abs(f) > 1e-10) {
    float lambda1 = (e + g - disc) * 0.5;
    tangent = vec2(lambda1 - g, f);
  } else if (e < g) {
    tangent = vec2(1.0, 0.0);
  } else {
    tangent = vec2(0.0, 1.0);
  }
  
  // Normalize
  float len = length(tangent);
  if (len > 1e-10) {
    tangent /= len;
  }
  
  // Output: R=tx, G=ty, B=magnitude (for refinement weighting)
  fragColor = vec4(tangent, mag, 1.0);
}
`;
const TANGENT_REFINE_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_tangents;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  vec4 current = texture(u_tangents, v_texCoord);
  vec2 currentT = current.rg;
  float currentMag = current.b;
  
  vec2 sum = vec2(0.0);
  float weightSum = 0.0;
  
  // 5x5 kernel (radius 2)
  for (int ky = -2; ky <= 2; ky++) {
    for (int kx = -2; kx <= 2; kx++) {
      vec2 offset = vec2(float(kx), float(ky)) * texel;
      vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
      
      vec4 neighbor = texture(u_tangents, sampleCoord);
      vec2 neighborT = neighbor.rg;
      float neighborMag = neighbor.b;
      
      // Direction weight with sign handling
      float dot_val = dot(currentT, neighborT);
      float sign_val = dot_val >= 0.0 ? 1.0 : -1.0;
      float dirWeight = abs(dot_val);
      
      float weight = neighborMag * dirWeight;
      
      sum += sign_val * neighborT * weight;
      weightSum += weight;
    }
  }
  
  vec2 refined = currentT;
  if (weightSum > 1e-10) {
    refined = sum / weightSum;
    float len = length(refined);
    if (len > 1e-10) {
      refined /= len;
    }
  }
  
  fragColor = vec4(refined, current.b, 1.0);
}
`;
/**
 * WebGL-accelerated ETF implementation
 */
export class EdgeTangentFlowWebGL {
    tangents;
    width;
    height;
    static resources = null;
    static supported = null;
    constructor(tangents, width, height) {
        this.tangents = tangents;
        this.width = width;
        this.height = height;
    }
    getTangent(x, y) {
        const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
        return this.tangents[clampedY * this.width + clampedX];
    }
    getTangentArray() {
        const result = new Float32Array(this.width * this.height * 2);
        for (let i = 0; i < this.tangents.length; i++) {
            result[i * 2] = this.tangents[i].x;
            result[i * 2 + 1] = this.tangents[i].y;
        }
        return result;
    }
    /**
     * Check if WebGL2 is supported
     */
    static isSupported() {
        if (this.supported !== null) {
            return this.supported;
        }
        try {
            const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(1, 1)
                : document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            this.supported = gl !== null;
            // Check for required extensions/features
            if (gl) {
                const ext = gl.getExtension('EXT_color_buffer_float');
                this.supported = ext !== null;
            }
        }
        catch {
            this.supported = false;
        }
        return this.supported;
    }
    /**
     * Initialize WebGL resources (lazy initialization)
     */
    static initResources(width, height) {
        if (this.resources) {
            // Resize canvas if needed
            const canvas = this.resources.canvas;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            return this.resources;
        }
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        if (!(canvas instanceof OffscreenCanvas)) {
            canvas.width = width;
            canvas.height = height;
        }
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }
        // Enable float textures
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');
        // Create shader programs
        const gradientProgram = createProgram(gl, VERTEX_SHADER, GRADIENT_SHADER);
        const structureTensorProgram = createProgram(gl, VERTEX_SHADER, STRUCTURE_TENSOR_SHADER);
        const gaussianBlurHProgram = createProgram(gl, VERTEX_SHADER, GAUSSIAN_BLUR_H_SHADER);
        const gaussianBlurVProgram = createProgram(gl, VERTEX_SHADER, GAUSSIAN_BLUR_V_SHADER);
        const tangentExtractProgram = createProgram(gl, VERTEX_SHADER, TANGENT_EXTRACT_SHADER);
        const tangentRefineProgram = createProgram(gl, VERTEX_SHADER, TANGENT_REFINE_SHADER);
        // Create fullscreen quad
        const quadVAO = gl.createVertexArray();
        const quadVBO = gl.createBuffer();
        gl.bindVertexArray(quadVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        this.resources = {
            gl,
            canvas,
            gradientProgram,
            structureTensorProgram,
            gaussianBlurHProgram,
            gaussianBlurVProgram,
            tangentExtractProgram,
            tangentRefineProgram,
            quadVAO,
            quadVBO,
        };
        return this.resources;
    }
    /**
     * Compute ETF using WebGL
     */
    static compute(input, config = {}, sigmaC) {
        const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
        const { width, height } = input;
        const res = this.initResources(width, height);
        const { gl } = res;
        gl.viewport(0, 0, width, height);
        // Create input texture
        const inputTex = createTexture(gl, width, height, gl.R32F, gl.RED, input.data);
        // Create framebuffers for ping-pong
        const gradientFB = createFramebuffer(gl, width, height, gl.RGBA32F);
        const tensorFB = createFramebuffer(gl, width, height, gl.RGBA32F);
        const blurTempFB = createFramebuffer(gl, width, height, gl.RGBA32F);
        const blurOutputFB = createFramebuffer(gl, width, height, gl.RGBA32F);
        const tangentFB1 = createFramebuffer(gl, width, height, gl.RGBA32F);
        const tangentFB2 = createFramebuffer(gl, width, height, gl.RGBA32F);
        // Step 1: Compute gradients
        gl.bindFramebuffer(gl.FRAMEBUFFER, gradientFB.fb);
        gl.useProgram(res.gradientProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.uniform1i(gl.getUniformLocation(res.gradientProgram, 'u_input'), 0);
        gl.uniform2f(gl.getUniformLocation(res.gradientProgram, 'u_resolution'), width, height);
        drawQuad(gl, res.quadVAO);
        // Step 2: Build structure tensor
        gl.bindFramebuffer(gl.FRAMEBUFFER, tensorFB.fb);
        gl.useProgram(res.structureTensorProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, gradientFB.tex);
        gl.uniform1i(gl.getUniformLocation(res.structureTensorProgram, 'u_gradients'), 0);
        drawQuad(gl, res.quadVAO);
        // Step 3: Gaussian blur the structure tensor
        const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
        const radius = Math.min(16, Math.ceil(smoothSigma * 2.45)); // Cap at 16 for shader array limit
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel(smoothSigma, kernelSize);
        // Horizontal blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurTempFB.fb);
        gl.useProgram(res.gaussianBlurHProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tensorFB.tex);
        gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_input'), 0);
        gl.uniform2f(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_resolution'), width, height);
        gl.uniform1fv(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_kernel'), kernel);
        gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_kernelSize'), kernelSize);
        gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_radius'), radius);
        drawQuad(gl, res.quadVAO);
        // Vertical blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurOutputFB.fb);
        gl.useProgram(res.gaussianBlurVProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurTempFB.tex);
        gl.uniform1i(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_input'), 0);
        gl.uniform2f(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_resolution'), width, height);
        gl.uniform1fv(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_kernel'), kernel);
        gl.uniform1i(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_kernelSize'), kernelSize);
        gl.uniform1i(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_radius'), radius);
        drawQuad(gl, res.quadVAO);
        // Step 4: Extract initial tangent field
        gl.bindFramebuffer(gl.FRAMEBUFFER, tangentFB1.fb);
        gl.useProgram(res.tangentExtractProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurOutputFB.tex);
        gl.uniform1i(gl.getUniformLocation(res.tangentExtractProgram, 'u_tensor'), 0);
        drawQuad(gl, res.quadVAO);
        // Step 5: Refine tangent field iteratively (ping-pong between framebuffers)
        let readFB = tangentFB1;
        let writeFB = tangentFB2;
        for (let i = 0; i < cfg.iterations; i++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB.fb);
            gl.useProgram(res.tangentRefineProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.tangentRefineProgram, 'u_tangents'), 0);
            gl.uniform2f(gl.getUniformLocation(res.tangentRefineProgram, 'u_resolution'), width, height);
            drawQuad(gl, res.quadVAO);
            // Swap
            [readFB, writeFB] = [writeFB, readFB];
        }
        // Read back results
        gl.bindFramebuffer(gl.FRAMEBUFFER, readFB.fb);
        const pixels = new Float32Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
        // Convert to Vec2 array
        const tangents = new Array(width * height);
        for (let i = 0; i < width * height; i++) {
            tangents[i] = {
                x: pixels[i * 4],
                y: pixels[i * 4 + 1],
            };
        }
        // Cleanup temporary resources
        gl.deleteTexture(inputTex);
        deleteFramebuffer(gl, gradientFB);
        deleteFramebuffer(gl, tensorFB);
        deleteFramebuffer(gl, blurTempFB);
        deleteFramebuffer(gl, blurOutputFB);
        deleteFramebuffer(gl, tangentFB1);
        deleteFramebuffer(gl, tangentFB2);
        return new EdgeTangentFlowWebGL(tangents, width, height);
    }
    /**
     * Visualize the flow field as a grayscale image
     */
    visualize() {
        const output = createGrayscaleImage(this.width, this.height);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                const t = this.tangents[idx];
                const angle = Math.atan2(t.y, t.x);
                output.data[idx] = (angle + Math.PI) / (2 * Math.PI);
            }
        }
        return output;
    }
    /**
     * Cleanup WebGL resources (call when done with all ETF computations)
     */
    static dispose() {
        if (this.resources) {
            const { gl } = this.resources;
            gl.deleteProgram(this.resources.gradientProgram);
            gl.deleteProgram(this.resources.structureTensorProgram);
            gl.deleteProgram(this.resources.gaussianBlurHProgram);
            gl.deleteProgram(this.resources.gaussianBlurVProgram);
            gl.deleteProgram(this.resources.tangentExtractProgram);
            gl.deleteProgram(this.resources.tangentRefineProgram);
            gl.deleteVertexArray(this.resources.quadVAO);
            gl.deleteBuffer(this.resources.quadVBO);
            this.resources = null;
        }
    }
}
// ============== Helper Functions ==============
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
}
function createProgram(gl, vertSrc, fragSrc) {
    const vert = createShader(gl, gl.VERTEX_SHADER, vertSrc);
    const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program link error: ${info}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return program;
}
function createTexture(gl, width, height, internalFormat, format, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, data ?? null);
    return tex;
}
function createFramebuffer(gl, width, height, internalFormat) {
    const tex = createTexture(gl, width, height, internalFormat, gl.RGBA, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${status}`);
    }
    return { fb, tex };
}
function deleteFramebuffer(gl, fb) {
    gl.deleteFramebuffer(fb.fb);
    gl.deleteTexture(fb.tex);
}
function drawQuad(gl, vao) {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
}
function generateGaussianKernel(sigma, size) {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    // Normalize
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    return kernel;
}
//# sourceMappingURL=webgl.js.map