/**
 * Two-pass FDoG blur: gradient-aligned DoG followed by flow-aligned smoothing
 *
 * This implements the full FDoG blur strategy as described in Section 2.6:
 * 1. Apply DoG across edges (gradient-aligned)
 * 2. Smooth the result along edges (flow-aligned)
 */
import { GradientAlignedBlur } from '..';
import { FlowGuidedBlur } from './flow-guided.js';
export class FDoGBlur {
    gradientBlur;
    flowBlur;
    sigmaM;
    static isSupported() {
        return true;
    }
    static getUnsupportedReason() {
        return undefined;
    }
    /**
     * @param flowField Edge tangent flow field
     * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
     * @param config Additional configuration
     */
    constructor(flowField, sigmaM, config = {}) {
        this.gradientBlur = new GradientAlignedBlur(flowField, config);
        this.flowBlur = new FlowGuidedBlur(flowField, config);
        this.sigmaM = sigmaM;
    }
    setFlowField(flowField) {
        this.gradientBlur.setFlowField(flowField);
        this.flowBlur.setFlowField(flowField);
    }
    setSigmaM(sigmaM) {
        this.sigmaM = sigmaM;
    }
    /**
     * Apply the two-pass FDoG blur
     * @param input Source image
     * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
     */
    async blur(input, sigma) {
        // Pass 1: Gradient-aligned blur (across edges)
        const gradientBlurred = await this.gradientBlur.blur(input, sigma);
        // Pass 2: Flow-aligned blur (along edges)
        const flowBlurred = await this.flowBlur.blur(gradientBlurred, this.sigmaM);
        return flowBlurred;
    }
    /**
     * Apply only gradient-aligned blur (for DoG computation)
     */
    async blurGradientAligned(input, sigma) {
        return this.gradientBlur.blur(input, sigma);
    }
    /**
     * Apply only flow-aligned blur (for post-processing/anti-aliasing)
     */
    async blurFlowAligned(input, sigma) {
        return this.flowBlur.blur(input, sigma);
    }
}
//# sourceMappingURL=fdog.js.map