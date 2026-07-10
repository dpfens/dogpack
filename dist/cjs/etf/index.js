"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EdgeTangentFlow = void 0;
const webgpu_js_1 = require("./webgpu.js");
const webgl_js_1 = require("./webgl.js");
const cpu_js_1 = require("./cpu.js");
/**
 * Unified Edge Tangent Flow that automatically selects the best implementation
 *
 * Preference order in 'auto' mode: WebGPU > WebGL > CPU. WebGPU compute is
 * inherently async (device acquisition + buffer readback both require
 * awaiting), so compute() is now async across the board — the WebGL and
 * CPU paths are still synchronous under the hood, but are wrapped so the
 * public API is consistent regardless of which implementation gets picked.
 */
class EdgeTangentFlow {
    impl;
    width;
    height;
    constructor(impl) {
        this.impl = impl;
        this.width = impl.width;
        this.height = impl.height;
    }
    getTangent(x, y) {
        return this.impl.getTangent(x, y);
    }
    getTangentArray() {
        return this.impl.getTangentArray();
    }
    visualize() {
        return this.impl.visualize();
    }
    /**
     * Check if WebGPU acceleration is available
     *
     * Note: this is the same cheap synchronous check EdgeTangentFlowWebGPU
     * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
     * can actually be obtained. Use EdgeTangentFlowWebGPU.getUnsupportedReason()
     * for a more thorough (async) check if needed.
     */
    static isWebGPUSupported() {
        return webgpu_js_1.EdgeTangentFlowWebGPU.isSupported();
    }
    /**
     * Check if WebGL acceleration is available
     */
    static isWebGLSupported() {
        return webgl_js_1.EdgeTangentFlowWebGL.isSupported();
    }
    /**
     * Compute ETF using the best available implementation
     *
     * @param input Grayscale image
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma
     * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'webgpu' | 'auto')
     */
    static async compute(input, config = {}, sigmaC, forceImpl = 'auto') {
        if (forceImpl === 'webgpu') {
            if (!webgpu_js_1.EdgeTangentFlowWebGPU.isSupported()) {
                throw new Error('WebGPU not supported but webgpu implementation was forced');
            }
            console.log('[ETF] Using WebGPU implementation (forced)');
            const impl = await webgpu_js_1.EdgeTangentFlowWebGPU.compute(input, config, sigmaC);
            return new EdgeTangentFlow(impl);
        }
        if (forceImpl === 'webgl') {
            if (!webgl_js_1.EdgeTangentFlowWebGL.isSupported()) {
                throw new Error('WebGL not supported but webgl implementation was forced');
            }
            console.log('[ETF] Using WebGL implementation (forced)');
            const impl = webgl_js_1.EdgeTangentFlowWebGL.compute(input, config, sigmaC);
            return new EdgeTangentFlow(impl);
        }
        if (forceImpl === 'cpu') {
            console.log('[ETF] Using CPU implementation (forced)');
            const impl = cpu_js_1.EdgeTangentFlow.compute(input, config, sigmaC);
            return new EdgeTangentFlow(impl);
        }
        // 'auto': prefer WebGPU, then WebGL, then CPU. Each tier falls through
        // to the next on failure — WebGPU in particular can pass the cheap
        // isSupported() check but still fail at adapter/device acquisition
        // time, so that's guarded with a try/catch rather than trusted blindly.
        if (webgpu_js_1.EdgeTangentFlowWebGPU.isSupported()) {
            try {
                console.log('[ETF] Using WebGPU implementation');
                const impl = await webgpu_js_1.EdgeTangentFlowWebGPU.compute(input, config, sigmaC);
                return new EdgeTangentFlow(impl);
            }
            catch (err) {
                console.warn('[ETF] WebGPU implementation failed, falling back:', err);
            }
        }
        if (webgl_js_1.EdgeTangentFlowWebGL.isSupported()) {
            try {
                console.log('[ETF] Using WebGL implementation');
                const impl = webgl_js_1.EdgeTangentFlowWebGL.compute(input, config, sigmaC);
                return new EdgeTangentFlow(impl);
            }
            catch (err) {
                console.warn('[ETF] WebGL implementation failed, falling back:', err);
            }
        }
        console.log('[ETF] Using CPU implementation');
        const impl = cpu_js_1.EdgeTangentFlow.compute(input, config, sigmaC);
        return new EdgeTangentFlow(impl);
    }
    /**
     * Cleanup WebGPU and WebGL resources
     */
    static dispose() {
        webgpu_js_1.EdgeTangentFlowWebGPU.dispose();
        webgl_js_1.EdgeTangentFlowWebGL.dispose();
    }
}
exports.EdgeTangentFlow = EdgeTangentFlow;
exports.default = EdgeTangentFlow;
//# sourceMappingURL=index.js.map