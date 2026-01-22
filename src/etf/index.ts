import { ETFConfig, FlowField, GrayscaleImage, Vec2 } from "../types";
import { EdgeTangentFlowWebGL } from "./webgl.js";
import { EdgeTangentFlow as EdgeTangentFlowCPU } from "./cpu.js";

/**
 * Unified Edge Tangent Flow that automatically selects the best implementation
 */
export class EdgeTangentFlow implements FlowField {
  private impl: FlowField;
  readonly width: number;
  readonly height: number;
  
  private constructor(impl: FlowField) {
    this.impl = impl;
    this.width = impl.width;
    this.height = impl.height;
  }
  
  getTangent(x: number, y: number): Vec2 {
    return this.impl.getTangent(x, y);
  }
  
  getTangentArray(): Float32Array {
    return (this.impl as any).getTangentArray();
  }
  
  visualize(): GrayscaleImage {
    return (this.impl as any).visualize();
  }
  
  /**
   * Check if WebGL acceleration is available
   */
  static isWebGLSupported(): boolean {
    return EdgeTangentFlowWebGL.isSupported();
  }
  
  /**
   * Compute ETF using the best available implementation
   * 
   * @param input Grayscale image
   * @param config ETF configuration
   * @param sigmaC Structure tensor smoothing sigma
   * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'auto')
   */
  static compute(
    input: GrayscaleImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number,
    forceImpl: 'cpu' | 'webgl' | 'auto' = 'auto'
  ): EdgeTangentFlow {
    let useWebGL = false;
    
    if (forceImpl === 'webgl') {
      if (!EdgeTangentFlowWebGL.isSupported()) {
        throw new Error('WebGL not supported but webgl implementation was forced');
      }
      useWebGL = true;
    } else if (forceImpl === 'auto') {
      useWebGL = EdgeTangentFlowWebGL.isSupported();
    }
    // forceImpl === 'cpu' leaves useWebGL as false
    
    if (useWebGL) {
      console.log('[ETF] Using WebGL implementation');
      const impl = EdgeTangentFlowWebGL.compute(input, config, sigmaC);
      return new EdgeTangentFlow(impl);
    } else {
      console.log('[ETF] Using CPU implementation');
      // Import dynamically to avoid circular deps if needed
      const impl = EdgeTangentFlowCPU.compute(input, config, sigmaC);
      return new EdgeTangentFlow(impl);
    }
  }
  
  /**
   * Cleanup WebGL resources
   */
  static dispose(): void {
    EdgeTangentFlowWebGL.dispose();
  }
}

export default EdgeTangentFlow;