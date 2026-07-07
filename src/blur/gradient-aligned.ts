/**
 * Gradient-aligned blur for FDoG
 * 
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
import type { BlurStrategy, ChannelImage, FlowField } from '../types';
import { createChannelImage, getPixelBilinear, generateGaussianKernel } from '../utils';
import { BaseCPUBlur } from './base';

/**
 * Configuration for flow-guided blur
 */
export interface GradientAlignedBlurConfig {
  /** 
   * Kernel size multiplier for flow-aligned LIC (default: 6)
   */
  kernelSizeMultiplier: number;
  
  /**
   * Step size for line integral convolution (default: 1.0)
   * Smaller values give smoother integration but cost more
   */
  stepSize: number;
}

const DEFAULT_FLOW_CONFIG: GradientAlignedBlurConfig = {
  kernelSizeMultiplier: 6,
  stepSize: 1.0,
};

export class CPUGradientAlignedBlur extends BaseCPUBlur implements BlurStrategy {
  private config: GradientAlignedBlurConfig;
  
  constructor(
    private flowField: FlowField,
    config: Partial<GradientAlignedBlurConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
  }

  dispose(): void {}
  
  setFlowField(flowField: FlowField): void {
    this.flowField = flowField;
  }
  
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    if (sigma < 0.1) {
      return {
        data: new Float32Array(input.data),
        width: input.width,
        height: input.height,
      };
    }
    
    const output = createChannelImage(input.width, input.height);
    
    // Number of samples perpendicular to flow
    const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
    const numSamples = halfSamples * 2 + 1;
    const weights = generateGaussianKernel(sigma, numSamples);
    
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const value = this.sampleAcrossFlow(input, x, y, halfSamples, weights);
        output.data[y * input.width + x] = value;
      }
    }
    
    return output;
  }
  
  /**
   * Sample perpendicular to the flow direction
   */
  private sampleAcrossFlow(
    input: ChannelImage,
    startX: number,
    startY: number,
    halfSamples: number,
    weights: Float32Array
  ): number {
    const stepSize = this.config.stepSize;
    let sum = 0;
    let weightSum = 0;
    
    // Get perpendicular direction (gradient direction)
    const tangent = this.flowField.getTangent(startX, startY);
    const gradX = -tangent.y;  // Perpendicular: rotate 90 degrees
    const gradY = tangent.x;
    
    // Sample at center
    sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
    weightSum += weights[halfSamples];
    
    // Sample in positive gradient direction
    for (let i = 1; i <= halfSamples; i++) {
      const px = startX + gradX * stepSize * i;
      const py = startY + gradY * stepSize * i;
      
      if (px < -0.5 || px > input.width - 0.5 || 
          py < -0.5 || py > input.height - 0.5) {
        break;
      }
      
      const idx = halfSamples + i;
      sum += getPixelBilinear(input, px, py) * weights[idx];
      weightSum += weights[idx];
    }
    
    // Sample in negative gradient direction
    for (let i = 1; i <= halfSamples; i++) {
      const px = startX - gradX * stepSize * i;
      const py = startY - gradY * stepSize * i;
      
      if (px < -0.5 || px > input.width - 0.5 || 
          py < -0.5 || py > input.height - 0.5) {
        break;
      }
      
      const idx = halfSamples - i;
      sum += getPixelBilinear(input, px, py) * weights[idx];
      weightSum += weights[idx];
    }
    
    return weightSum > 0 ? sum / weightSum : 0;
  }
}

export class GradientAlignedBlur implements BlurStrategy {
  private instance: BlurStrategy & { setFlowField?(flowField: FlowField): void; dispose?(): void };
  
  constructor(flowField: FlowField, config: Partial<GradientAlignedBlurConfig> = {}) {
    this.instance = new CPUGradientAlignedBlur(flowField, config);
  }
  
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    return this.instance.blur(input, sigma);
  }
  
  setFlowField(flowField: FlowField): void {
    if (this.instance.setFlowField) {
      this.instance.setFlowField(flowField);
    }
  }
  
  dispose(): void {
    if (this.instance.dispose) {
      this.instance.dispose();
    }
  }
}