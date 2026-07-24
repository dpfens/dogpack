/**
 * Shared FlowField result type for Edge Tangent Flow backends.
 */
import type { ChannelImage, FlowField, Vec2 } from '../interfaces/base.js';
export declare class TangentFlowField implements FlowField {
    private readonly tangents;
    readonly width: number;
    readonly height: number;
    private readonly magnitude?;
    private readonly anisotropy?;
    private constructor();
    static fromFloat32Array(tangents: Float32Array, width: number, height: number, magnitude?: Float32Array, anisotropy?: Float32Array): TangentFlowField;
    static fromVec2Array(tangents: Vec2[], width: number, height: number, magnitude?: Float32Array, anisotropy?: Float32Array): TangentFlowField;
    getTangent(x: number, y: number): Vec2;
    getTangentArray(): Float32Array;
    private clampedIndex;
    getMagnitude(x: number, y: number): number;
    getAnisotropy(x: number, y: number): number;
    /**
     * Visualize the flow field as a grayscale image.
     * Encodes direction as intensity (useful for debugging).
     */
    visualize(): ChannelImage;
    /**
     * Visualize as a color image (HSV with direction as hue).
     */
    visualizeColor(): ImageData;
}
//# sourceMappingURL=flow-field.d.ts.map