/**
 * WebGL-accelerated Edge Tangent Flow computation
 *
 * Provides significant speedup over CPU implementation by running
 * gradient computation, structure tensor building/smoothing, and
 * tangent extraction on the GPU.
 */
import { GrayscaleImage, FlowField, Vec2, ETFConfig } from '../types.js';
/**
 * WebGL-accelerated ETF implementation
 */
export declare class EdgeTangentFlowWebGL implements FlowField {
    private tangents;
    readonly width: number;
    readonly height: number;
    private static resources;
    private static supported;
    private constructor();
    getTangent(x: number, y: number): Vec2;
    getTangentArray(): Float32Array;
    /**
     * Check if WebGL2 is supported
     */
    static isSupported(): boolean;
    /**
     * Initialize WebGL resources (lazy initialization)
     */
    private static initResources;
    /**
     * Compute ETF using WebGL
     */
    static compute(input: GrayscaleImage, config?: Partial<ETFConfig>, sigmaC?: number): EdgeTangentFlowWebGL;
    /**
     * Visualize the flow field as a grayscale image
     */
    visualize(): GrayscaleImage;
    /**
     * Cleanup WebGL resources (call when done with all ETF computations)
     */
    static dispose(): void;
}
//# sourceMappingURL=webgl.d.ts.map