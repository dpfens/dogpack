/**
 * Pipeline step specification
 */
export type PipelineStep<TIn, TOut> = {
    name: string;
    apply: (input: TIn) => Promise<TOut>;
};
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
export declare class ExtensionPipeline<TInput, TCurrent = TInput> {
    private steps;
    /**
     * Add a processing step to the pipeline
     */
    addStep<TNext>(name: string, fn: (input: TCurrent) => Promise<TNext>): ExtensionPipeline<TInput, TNext>;
    /**
     * Run the pipeline
     */
    run(input: TInput): Promise<TCurrent>;
    /**
     * Get step names for debugging
     */
    getStepNames(): string[];
}
//# sourceMappingURL=pipeline.d.ts.map