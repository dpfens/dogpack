import { BlurStrategy, GrayscaleImage, FlowField } from '../types.js';
import { FlowGuidedBlurConfig } from './flow-guided.js';
export declare class FDoGBlur implements BlurStrategy {
    private gradientBlur;
    private flowBlur;
    private sigmaM;
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    /**
     * @param flowField Edge tangent flow field
     * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
     * @param config Additional configuration
     */
    constructor(flowField: FlowField, sigmaM: number, config?: Partial<FlowGuidedBlurConfig>);
    setFlowField(flowField: FlowField): void;
    setSigmaM(sigmaM: number): void;
    /**
     * Apply the two-pass FDoG blur
     * @param input Source image
     * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
     */
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Apply only gradient-aligned blur (for DoG computation)
     */
    blurGradientAligned(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Apply only flow-aligned blur (for post-processing/anti-aliasing)
     */
    blurFlowAligned(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
}
//# sourceMappingURL=fdog.d.ts.map