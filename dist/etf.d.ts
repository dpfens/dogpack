/**
 * Edge Tangent Flow computation for FDoG
 *
 * The ETF represents the direction of edges at each pixel, computed from
 * the structure tensor of the image gradients.
 */
import { GrayscaleImage, FlowField, Vec2, ETFConfig } from './types.js';
/**
 * Edge Tangent Flow field implementation
 */
export declare class EdgeTangentFlow implements FlowField {
    private tangents;
    readonly width: number;
    readonly height: number;
    private constructor();
    getTangent(x: number, y: number): Vec2;
    /**
     * Compute Edge Tangent Flow from a grayscale image
     */
    static compute(input: GrayscaleImage, config?: Partial<ETFConfig>): EdgeTangentFlow;
}
//# sourceMappingURL=etf.d.ts.map