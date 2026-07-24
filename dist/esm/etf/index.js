import { WebGpuEdgeTangentFlowComputer } from './webgpu.js';
import { WebGLEdgeTangentFlowComputer } from './webgl.js';
import { CpuEdgeTangentFlowComputer } from './cpu.js';
/**
 * Edge Tangent Flow computer that automatically resolves to the best
 * supported backend, with graceful single-retry fallback if that backend
 * fails after selection (driver crash, lost context, etc).
 *
 */
export class EdgeTangentFlowComputer {
    instance;
    currentCtor;
    failedBackends = new Set();
    constructor(instance, currentCtor) {
        this.instance = instance;
        this.currentCtor = currentCtor;
    }
    static candidates = [
        WebGpuEdgeTangentFlowComputer,
        WebGLEdgeTangentFlowComputer,
        CpuEdgeTangentFlowComputer,
    ];
    static async create() {
        for (const Ctor of EdgeTangentFlowComputer.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return new EdgeTangentFlowComputer(new Ctor(), Ctor);
                }
                catch {
                    continue; // isSupported() lied — try next
                }
            }
        }
        throw new Error('No supported ETF computer implementation available');
    }
    /**
     * Which backend is actually running right now. Can change over the
     * life of this instance if a fallback occurs mid-session.
     */
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    /**
     * Compute an Edge Tangent Flow. The returned FlowField carries its own
     * magnitude/anisotropy (see interfaces/base.ts) — there is no separate
     * "detailed" variant anymore.
     */
    async compute(input, config = {}, sigmaC) {
        return this.callWithFallback(computer => computer.compute(input, config, sigmaC));
    }
    async computeMultiChannel(inputs, config = {}, sigmaC) {
        return this.callWithFallback(computer => computer.computeMultiChannel(inputs, config, sigmaC));
    }
    async callWithFallback(op) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await op(this.instance);
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
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of EdgeTangentFlowComputer.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor();
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor); // isSupported() lied — try next
                }
            }
        }
        return null;
    }
}
export default EdgeTangentFlowComputer;
//# sourceMappingURL=index.js.map