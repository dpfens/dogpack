/**
 * CPU Edge Tangent Flow computation for FDoG
 *
 * The ETF represents the direction of edges at each pixel, computed from
 * the structure tensor of the image gradients.
 *
 * Based on Section 2.6 of Winnemöller et al. (2012) and
 * Kang et al. (2007) "Coherent Line Drawing"
 *
 * Multi-channel support follows Di Zenzo's approach ("A note on the
 * gradient of a multi-image", CVGIP 33, 1986): per-channel structure
 * tensors are summed (not the resulting tangents), and a single
 * eigendecomposition is performed on the combined tensor. Everything
 * from smoothing onward is identical regardless of how many channels
 * fed into the tensor, so the single-channel and multi-channel paths
 * share one pipeline.
 *
 * This module has no knowledge of color spaces. It operates purely on
 * ChannelImage scalar fields; RGB/Lab/etc. splitting and conversion is
 * the caller's responsibility (see utils/color.ts) and happens before
 * compute()/computeMultiChannel() is ever called.
 */
import type { ChannelImage, FlowField, ETFConfig, ETFComputer, ETFDetailedResult } from '../interfaces/base.js';
import { BaseCPUStrategy } from '../base.js';
/**
 * CPU-backed ETFComputer. Synchronous under the hood, but exposes the
 * same async ETFComputer contract as the WebGL/WebGPU backends so callers
 * can swap implementations without caring which one they have.
 */
export declare class CpuEdgeTangentFlowComputer extends BaseCPUStrategy implements ETFComputer {
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeDetailed(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<ETFDetailedResult>;
    computeMultiChannelDetailed(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<ETFDetailedResult>;
    private validateChannels;
}
//# sourceMappingURL=cpu.d.ts.map