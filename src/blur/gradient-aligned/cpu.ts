/**
 * Gradient-aligned blur for FDoG
 * 
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
import {
  DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG,
  type BlurStrategy,
  type ChannelImage,
  type FlowField,
  type GradientAlignedBlurBackendConfig,
  type GradientAlignedBlurConfig,
} from '../../interfaces/base.js';
import { BaseCPUStrategy } from '../../base.js';
import { createChannelImage, getPixelBilinear } from '../../utils/image.js';
import { generateGaussianKernel } from '../../utils/math.js';


export class CPUGradientAlignedBlur extends BaseCPUStrategy implements BlurStrategy {
  readonly backend = 'cpu' as const;
  private config: GradientAlignedBlurConfig;
  private flowField: FlowField;

  constructor(config: GradientAlignedBlurBackendConfig) {
    super();
    this.flowField = config.flowField;
    this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
  }

  static async isSupported(): Promise<boolean> {
    return true;
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