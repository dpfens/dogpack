"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GradientAlignedBlur = void 0;
const index_js_1 = require("../../utils/index.js");
const cpu_js_1 = require("./cpu.js");
const webgl_js_1 = require("./webgl.js");
const webgpu_js_1 = require("./webgpu.js");
class GradientAlignedBlur {
    flowField;
    config;
    instance;
    backend = 'cpu';
    initPromise;
    constructor(flowField, config = {}) {
        this.flowField = flowField;
        this.config = config;
        // Always start with a working CPU instance so the object is valid the
        // instant it's constructed. blur() awaits initPromise before running,
        // so no work actually happens on this instance unless backend upgrade
        // fails entirely — it's a fallback, not a "first frame is slow" thing.
        this.instance = new cpu_js_1.CPUGradientAlignedBlur(flowField, config);
        this.backend = 'cpu';
        this.initPromise = this.upgradeBackend();
    }
    /**
     * Preferred construction path — resolves only once backend detection has
     * finished, so `getBackend()` is meaningful immediately.
     */
    static async create(flowField, config = {}) {
        const instance = new GradientAlignedBlur(flowField, config);
        await instance.ready();
        return instance;
    }
    /** Resolves once GPU backend detection/initialization has settled (including CPU fallback). */
    ready() {
        return this.initPromise;
    }
    getBackend() {
        return this.backend;
    }
    async upgradeBackend() {
        const t0 = performance.now();
        if (await (0, index_js_1.isWebGPUSupported)()) {
            try {
                const gpuInstance = await webgpu_js_1.WebGPUGradientAlignedBlur.create(this.flowField, this.config);
                this.instance.dispose?.();
                this.instance = gpuInstance;
                this.backend = 'webgpu';
                console.log(`[GradientAlignedBlur] Using WebGPU backend (init: ${(performance.now() - t0).toFixed(2)}ms)`);
                return;
            }
            catch (err) {
                console.warn('[GradientAlignedBlur] WebGPU init failed, falling back:', err);
            }
        }
        if ((0, index_js_1.isWebGLComputeSupported)()) {
            try {
                const glInstance = new webgl_js_1.WebGLGradientAlignedBlur(this.flowField, this.config);
                this.instance.dispose?.();
                this.instance = glInstance;
                this.backend = 'webgl';
                console.log(`[GradientAlignedBlur] Using WebGL2 backend (init: ${(performance.now() - t0).toFixed(2)}ms)`);
                return;
            }
            catch (err) {
                console.warn('[GradientAlignedBlur] WebGL2 init failed, falling back to CPU:', err);
            }
        }
        console.log(`[GradientAlignedBlur] Using CPU backend (fallback) (detection: ${(performance.now() - t0).toFixed(2)}ms)`);
    }
    async blur(input, sigma) {
        await this.initPromise;
        return this.instance.blur(input, sigma);
    }
    setFlowField(flowField) {
        this.flowField = flowField;
        this.instance.setFlowField?.(flowField);
    }
    dispose() {
        this.instance.dispose?.();
    }
}
exports.GradientAlignedBlur = GradientAlignedBlur;
//# sourceMappingURL=index.js.map