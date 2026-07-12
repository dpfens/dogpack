/**
 * Shared FlowField result type for Edge Tangent Flow backends.
 *
 * Every ETFComputer backend (CPU, WebGPU, WebGL, ...) ends up with the
 * same thing: a per-pixel unit tangent vector field plus width/height.
 * The only thing that differs between backends is how that field arrives
 * — the CPU backend naturally produces an array of Vec2 objects (the
 * eigen-math is inherently per-pixel), while GPU backends read back a
 * flat Float32Array from a storage buffer and would rather not allocate
 * a pixel-count of JS objects while doing it. TangentFlowField accepts
 * either via its two factory functions and stores tangents as a flat
 * stride-2 Float32Array either way, so getTangent/getTangentArray/
 * visualize/visualizeColor are implemented exactly once.
 */
import type { ChannelImage, FlowField, Vec2 } from '../types.js';
export declare class TangentFlowField implements FlowField {
    private readonly tangents;
    readonly width: number;
    readonly height: number;
    private constructor();
    /**
     * Construct from a flat stride-2 Float32Array, e.g. a GPU buffer
     * readback. Takes ownership of the array — callers should not mutate
     * it afterward.
     */
    static fromFloat32Array(tangents: Float32Array, width: number, height: number): TangentFlowField;
    /**
     * Construct from a per-pixel Vec2 array, e.g. the output of a CPU
     * eigendecomposition pipeline. Copies into a flat stride-2 layout.
     */
    static fromVec2Array(tangents: Vec2[], width: number, height: number): TangentFlowField;
    getTangent(x: number, y: number): Vec2;
    /**
     * Get all tangents as a flat array (for GPU upload). Returns a copy so
     * callers can't mutate internal state out from under us.
     */
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