/**
 * Edge Tangent Flow computation for FDoG
 *
 * The ETF represents the direction of edges at each pixel, computed from
 * the structure tensor of the image gradients.
 *
 * Based on Section 2.6 of Winnemöller et al. (2012) and
 * Kang et al. (2007) "Coherent Line Drawing"
 */
import { GrayscaleImage, FlowField, Vec2, ETFConfig } from '../types.js';
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
     * Get all tangents as a flat array (for GPU upload)
     */
    getTangentArray(): Float32Array;
    /**
     * Compute Edge Tangent Flow from a grayscale image
     *
     * @param input Grayscale image (values in 0-1)
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma (optional override)
     */
    static compute(input: GrayscaleImage, config?: Partial<ETFConfig>, sigmaC?: number): EdgeTangentFlow;
    /**
     * Visualize the flow field as a grayscale image
     * Encodes direction as intensity (useful for debugging)
     */
    visualize(): GrayscaleImage;
    /**
     * Visualize as a color image (HSV with direction as hue)
     */
    visualizeColor(): ImageData;
}
//# sourceMappingURL=cpu.d.ts.map