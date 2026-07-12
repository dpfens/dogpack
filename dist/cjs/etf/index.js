"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EdgeTangentFlowComputer = void 0;
const webgpu_js_1 = require("./webgpu.js");
const webgl_js_1 = require("./webgl.js");
const cpu_js_1 = require("./cpu.js");
/**
 * Edge Tangent Flow computer that automatically selects the best available
 * backend implementation.
 *
 * Preference order in 'auto' mode: WebGPU > WebGL > CPU. Backend selection
 * is stateful and happens at most once per instance: the first call to
 * compute()/computeMultiChannel() probes backends (honoring `forceImpl`,
 * or falling back WebGPU -> WebGL -> CPU) and caches whichever one
 * actually works; every later call on this instance reuses that same
 * backend directly. This avoids re-attempting WebGPU/WebGL acquisition on
 * every call, and means dispose() has a single, well-defined backend
 * instance to release GPU resources from.
 */
class EdgeTangentFlowComputer {
    forceImpl;
    computer = null;
    constructor(forceImpl = 'auto') {
        this.forceImpl = forceImpl;
    }
    /**
     * Check if WebGPU acceleration is available.
     *
     * Note: this is the same cheap synchronous check WebGpuEdgeTangentFlowComputer
     * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
     * can actually be obtained. Use WebGpuEdgeTangentFlowComputer.getUnsupportedReason()
     * for a more thorough (async) check if needed.
     */
    static isWebGPUSupported() {
        return webgpu_js_1.WebGpuEdgeTangentFlowComputer.isSupported();
    }
    /**
     * Check if WebGL acceleration is available.
     */
    static isWebGLSupported() {
        return webgl_js_1.WebGLEdgeTangentFlowComputer.isSupported();
    }
    compute(input, config = {}, sigmaC) {
        return this.run(computer => computer.compute(input, config, sigmaC));
    }
    computeMultiChannel(inputs, config = {}, sigmaC) {
        return this.run(computer => computer.computeMultiChannel(inputs, config, sigmaC));
    }
    /**
     * Release resources held by whichever backend this instance resolved to.
     * No-op if compute()/computeMultiChannel() was never called, since
     * nothing was ever instantiated.
     */
    dispose() {
        this.computer?.dispose();
        this.computer = null;
    }
    /**
     * Run `op` against the resolved backend, resolving (and caching) it on
     * first use. `op` is what actually drives selection in 'auto' mode: a
     * backend only "wins" once it has successfully produced a result, not
     * merely passed isSupported(), since WebGPU/WebGL can pass that cheap
     * check and still fail at adapter/device/shader-compile time.
     */
    async run(op) {
        if (this.computer) {
            return op(this.computer);
        }
        if (this.forceImpl === 'webgpu') {
            if (!webgpu_js_1.WebGpuEdgeTangentFlowComputer.isSupported()) {
                throw new Error('WebGPU not supported but webgpu implementation was forced');
            }
            console.log('[ETF] Using WebGPU implementation (forced)');
            const computer = new webgpu_js_1.WebGpuEdgeTangentFlowComputer();
            const result = await op(computer);
            this.computer = computer;
            return result;
        }
        if (this.forceImpl === 'webgl') {
            if (!webgl_js_1.WebGLEdgeTangentFlowComputer.isSupported()) {
                throw new Error('WebGL not supported but webgl implementation was forced');
            }
            console.log('[ETF] Using WebGL implementation (forced)');
            const computer = new webgl_js_1.WebGLEdgeTangentFlowComputer();
            const result = await op(computer);
            this.computer = computer;
            return result;
        }
        if (this.forceImpl === 'cpu') {
            console.log('[ETF] Using CPU implementation (forced)');
            const computer = new cpu_js_1.CpuEdgeTangentFlowComputer();
            const result = await op(computer);
            this.computer = computer;
            return result;
        }
        // 'auto': prefer WebGPU, then WebGL, then CPU. Each tier is disposed
        // immediately if op() throws, so a failed attempt doesn't leak a GPU
        // context while we move on to the next tier.
        if (webgpu_js_1.WebGpuEdgeTangentFlowComputer.isSupported()) {
            const computer = new webgpu_js_1.WebGpuEdgeTangentFlowComputer();
            try {
                console.log('[ETF] Using WebGPU implementation');
                const result = await op(computer);
                this.computer = computer;
                return result;
            }
            catch (err) {
                console.warn('[ETF] WebGPU implementation failed, falling back:', err);
                computer.dispose();
            }
        }
        if (webgl_js_1.WebGLEdgeTangentFlowComputer.isSupported()) {
            const computer = new webgl_js_1.WebGLEdgeTangentFlowComputer();
            try {
                console.log('[ETF] Using WebGL implementation');
                const result = await op(computer);
                this.computer = computer;
                return result;
            }
            catch (err) {
                console.warn('[ETF] WebGL implementation failed, falling back:', err);
                computer.dispose();
            }
        }
        console.log('[ETF] Using CPU implementation');
        const computer = new cpu_js_1.CpuEdgeTangentFlowComputer();
        const result = await op(computer);
        this.computer = computer;
        return result;
    }
}
exports.EdgeTangentFlowComputer = EdgeTangentFlowComputer;
exports.default = EdgeTangentFlowComputer;
//# sourceMappingURL=index.js.map