"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GradientAlignedBlur = void 0;
const cpu_js_1 = require("./cpu.js");
const webgl_js_1 = require("./webgl.js");
const webgpu_js_1 = require("./webgpu.js");
class GradientAlignedBlur {
    instance;
    currentCtor;
    flowField;
    config;
    failedBackends = new Set();
    constructor(instance, currentCtor, flowField, config) {
        this.instance = instance;
        this.currentCtor = currentCtor;
        this.flowField = flowField;
        this.config = config;
    }
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        webgpu_js_1.WebGPUGradientAlignedBlur,
        webgl_js_1.WebGLGradientAlignedBlur,
        cpu_js_1.CPUGradientAlignedBlur,
    ];
    static async create(flowField, config = {}) {
        for (const Ctor of GradientAlignedBlur.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    const instance = new Ctor({ ...config, flowField });
                    return new GradientAlignedBlur(instance, Ctor, flowField, config);
                }
                catch {
                    continue; // isSupported() lied
                }
            }
        }
        throw new Error('No supported gradient-aligned blur implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async blur(input, sigma) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.blur(input, sigma);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    /**
     * Propagates to whatever backend is currently running, and is also
     * remembered for any future backend constructed by demoteAndFindNext()
     * (fallback instances are built fresh via `new Ctor(config)`, so the
     * current flow field has to be threaded through `config` each time
     * rather than mutated on an existing instance).
     */
    setFlowField(flowField) {
        this.flowField = flowField;
        this.instance.setFlowField?.(flowField);
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of GradientAlignedBlur.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    console.warn(`Falling back to ${Ctor.name}`);
                    this.instance = new Ctor({ ...this.config, flowField: this.flowField });
                    this.currentCtor = Ctor;
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor);
                }
            }
        }
        return null;
    }
}
exports.GradientAlignedBlur = GradientAlignedBlur;
//# sourceMappingURL=index.js.map