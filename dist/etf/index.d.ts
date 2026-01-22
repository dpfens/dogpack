import { ETFConfig, FlowField, GrayscaleImage, Vec2 } from "../types";
/**
 * Unified Edge Tangent Flow that automatically selects the best implementation
 */
export declare class EdgeTangentFlow implements FlowField {
    private impl;
    readonly width: number;
    readonly height: number;
    private constructor();
    getTangent(x: number, y: number): Vec2;
    getTangentArray(): Float32Array;
    visualize(): GrayscaleImage;
    /**
     * Check if WebGL acceleration is available
     */
    static isWebGLSupported(): boolean;
    /**
     * Compute ETF using the best available implementation
     *
     * @param input Grayscale image
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma
     * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'auto')
     */
    static compute(input: GrayscaleImage, config?: Partial<ETFConfig>, sigmaC?: number, forceImpl?: 'cpu' | 'webgl' | 'auto'): EdgeTangentFlow;
    /**
     * Cleanup WebGL resources
     */
    static dispose(): void;
}
export default EdgeTangentFlow;
//# sourceMappingURL=index.d.ts.map