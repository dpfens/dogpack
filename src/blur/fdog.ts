/**
 * Two-pass FDoG blur: gradient-aligned DoG followed by flow-aligned smoothing
 * 
 * This implements the full FDoG blur strategy as described in the paper:
 * 1. Apply DoG across edges (gradient-aligned)
 * 2. Smooth the result along edges (flow-aligned)
 */
import { GradientAlignedBlur } from './gradient-aligned/index.js';
import type { BlurStrategy,  ChannelImage, FlowField } from '../types.js';
import { FlowGuidedBlur, type FlowGuidedBlurConfig } from './flow-guided.js';


export class FDoGBlur implements BlurStrategy {
  private gradientBlur: GradientAlignedBlur;
  private flowBlur: FlowGuidedBlur;
  private sigmaM: number;
  
  static isSupported(): boolean {
    return true;
  }
  
  static getUnsupportedReason(): string | undefined {
    return undefined;
  }
  
  /**
   * @param flowField Edge tangent flow field
   * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
   * @param config Additional configuration
   */
  constructor(
    flowField: FlowField,
    sigmaM: number,
    config: Partial<FlowGuidedBlurConfig> = {}
  ) {
    this.gradientBlur = new GradientAlignedBlur(flowField, config);
    this.flowBlur = new FlowGuidedBlur(flowField, config);
    this.sigmaM = sigmaM;
  }

  dispose(): void {
    this.gradientBlur.dispose();
    this.flowBlur.dispose();
  }
  
  setFlowField(flowField: FlowField): void {
    this.gradientBlur.setFlowField(flowField);
    this.flowBlur.setFlowField(flowField);
  }
  
  setSigmaM(sigmaM: number): void {
    this.sigmaM = sigmaM;
  }
  
  /**
   * Apply the two-pass FDoG blur
   * @param input Source image
   * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
   */
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    // Pass 1: Gradient-aligned blur (across edges)
    const gradientBlurred = await this.gradientBlur.blur(input, sigma);
    
    // Pass 2: Flow-aligned blur (along edges)
    const flowBlurred = await this.flowBlur.blur(gradientBlurred, this.sigmaM);
    
    return flowBlurred;
  }
  
  /**
   * Apply only gradient-aligned blur (for DoG computation)
   */
  async blurGradientAligned(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    return this.gradientBlur.blur(input, sigma);
  }
  
  /**
   * Apply only flow-aligned blur (for post-processing/anti-aliasing)
   */
  async blurFlowAligned(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    return this.flowBlur.blur(input, sigma);
  }
}