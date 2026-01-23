/**
 * Extension Pipeline
 *
 * Composes multiple extension strategies into a single processing pipeline.
 * Provides type-safe chaining of operations.
 *
 * @example
 * ```typescript
 * const pipeline = new ExtensionPipeline()
 *   .addStep('naturalMedia', async (input: GrayscaleImage) => {
 *     const nm = new NaturalMediaStrategy({ style: 'pastel' });
 *     return nm.apply(input);
 *   })
 *   .addStep('antiAlias', async (image: GrayscaleImage) => {
 *     const etf = EdgeTangentFlow.compute(originalInput);
 *     const aa = new AntiAliasingStrategy({ sigma: 1.5 });
 *     return aa.apply({ image, etf });
 *   });
 *
 * const result = await pipeline.run(input);
 * ```
 */
export class ExtensionPipeline {
    steps = [];
    /**
     * Add a processing step to the pipeline
     */
    addStep(name, fn) {
        this.steps.push({ name, fn });
        return this;
    }
    /**
     * Run the pipeline
     */
    async run(input) {
        let current = input;
        for (const step of this.steps) {
            current = await step.fn(current);
        }
        return current;
    }
    /**
     * Get step names for debugging
     */
    getStepNames() {
        return this.steps.map(s => s.name);
    }
}
//# sourceMappingURL=pipeline.js.map