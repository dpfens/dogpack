/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" filters.
 */
export class ResilientEdgeAwareFilter {
    candidates;
    config;
    failedBackends = new Set();
    instance;
    currentCtor;
    /**
     * Subclasses resolve their instance via `resolve()` *before* calling
     * this (in their own async static `create()`), then hand the result in
     * here. The constructor itself stays synchronous, as constructors must.
     */
    constructor(candidates, resolved, config) {
        this.candidates = candidates;
        this.config = config;
        this.instance = resolved.instance;
        this.currentCtor = resolved.ctor;
    }
    /**
     * Try each candidate in order, skipping unsupported ones. If a
     * candidate reports supported but throws on construction anyway
     * (isSupported() lied), move on to the next.
     */
    static async resolve(candidates, config) {
        for (const Ctor of candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return { instance: new Ctor(config), ctor: Ctor };
                }
                catch {
                    continue;
                }
            }
        }
        throw new Error('No supported filter implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async apply(input, options) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.apply(input, options);
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
        for (const Ctor of this.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor(this.config);
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
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
//# sourceMappingURL=resilient-filter.js.map