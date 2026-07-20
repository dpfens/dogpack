/**
 * Shared FlowField result type for Edge Tangent Flow backends.
 */
import type { ChannelImage, FlowField, Vec2 } from '../interfaces/base.js';
export declare class TangentFlowField implements FlowField {
    private readonly tangents;
    readonly width: number;
    readonly height: number;
    private constructor();
    static fromFloat32Array(tangents: Float32Array, width: number, height: number): TangentFlowField;
    static fromVec2Array(tangents: Vec2[], width: number, height: number): TangentFlowField;
    getTangent(x: number, y: number): Vec2;
    getTangentArray(): Float32Array;
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