import { ChannelImage } from "./types.js";
import { createChannelImage } from "./utils.js";

/**
 * Thresholding strategy interface
 * Allows different thresholding approaches to be plugged in
 */
export interface ThresholdStrategy {
  /**
   * Apply thresholding to a sharpened image
   * @param sharpened The sharpened DoG image
   * @param config Configuration containing epsilon, phi, and other threshold parameters
   * @returns Thresholded output image
   */
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}

/**
 * Configuration for thresholding operations
 */
export interface ThresholdConfig {
  epsilon: number;                // Base threshold value
  phi: number;                    // Soft threshold sharpness
  epsilonHigh?: number;           // High threshold for hysteresis
  epsilonLow?: number;            // Low threshold for hysteresis
  localContrastRadius?: number;   // Radius for local contrast computation
  bilateralRadius?: number;       // Radius for bilateral filtering
  bilateralSigmaIntensity?: number; // Intensity sigma for bilateral filter
}

/**
 * Original soft threshold strategy (default)
 * Uses: T_ε,φ(u) = 1 + tanh(φ · (u - ε))
 */
export class SoftThresholdStrategy implements ThresholdStrategy {
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage {
    const output = createChannelImage(sharpened.width, sharpened.height);
    const size = sharpened.width * sharpened.height;
    
    for (let i = 0; i < size; i++) {
      const u = sharpened.data[i];
      output.data[i] = u >= config.epsilon ? 1.0 : 1.0 + Math.tanh(config.phi * (u - config.epsilon));
    }
    
    return output;
  }
}

/**
 * Adaptive threshold strategy
 * Spatially-varying threshold: ε(x,y) = ε_base + LocalContrast(x,y)
 * Reduces artifacts in low-contrast regions
 */
export class AdaptiveThresholdStrategy implements ThresholdStrategy {
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage {
    const radius = config.localContrastRadius ?? 5;
    const output = createChannelImage(sharpened.width, sharpened.height);
    const { width, height } = sharpened;
    
    // Compute local contrast map
    const localContrast = this.computeLocalContrast(sharpened, radius);
    
    // Apply adaptive thresholding
    const size = width * height;
    for (let i = 0; i < size; i++) {
      const u = sharpened.data[i];
      const adaptiveEpsilon = config.epsilon + localContrast.data[i];
      output.data[i] = u >= adaptiveEpsilon 
        ? 1.0 
        : 1.0 + Math.tanh(config.phi * (u - adaptiveEpsilon));
    }
    
    return output;
  }
  
  /**
   * Compute local contrast (standard deviation) in a neighborhood
   */
  private computeLocalContrast(image: ChannelImage, radius: number): ChannelImage {
    const output = createChannelImage(image.width, image.height);
    const { width, height } = image;
    const diameter = radius * 2 + 1;
    const normalizationFactor = 1.0 / (diameter * diameter);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // Compute mean
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              sum += image.data[ny * width + nx];
              count++;
            }
          }
        }
        const mean = sum / count;
        
        // Compute standard deviation
        let sumSquares = 0;
        count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const diff = image.data[ny * width + nx] - mean;
              sumSquares += diff * diff;
              count++;
            }
          }
        }
        const stdDev = Math.sqrt(sumSquares / count);
        output.data[idx] = stdDev * 0.1; // Scale factor to keep it in reasonable range
      }
    }
    
    return output;
  }
}

/**
 * Bilateral soft threshold strategy
 * Considers neighborhood similarity to prevent isolated pixel artifacts
 * and improve edge connectivity
 */
export class BilateralThresholdStrategy implements ThresholdStrategy {
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage {
    const radius = config.bilateralRadius ?? 3;
    const sigmaIntensity = config.bilateralSigmaIntensity ?? 0.2;
    const output = createChannelImage(sharpened.width, sharpened.height);
    const { width, height } = sharpened;
    
    // Apply bilateral filtering first to smooth while preserving edges
    const filtered = this.bilateralFilter(sharpened, radius, sigmaIntensity);
    
    // Then apply soft threshold to the filtered result
    const size = width * height;
    for (let i = 0; i < size; i++) {
      const u = filtered.data[i];
      output.data[i] = u >= config.epsilon 
        ? 1.0 
        : 1.0 + Math.tanh(config.phi * (u - config.epsilon));
    }
    
    return output;
  }
  
  /**
   * Apply bilateral filtering to reduce noise while preserving edges
   */
  private bilateralFilter(
    image: ChannelImage,
    radius: number,
    sigmaIntensity: number
  ): ChannelImage {
    const output = createChannelImage(image.width, image.height);
    const { width, height } = image;
    const sigmaSpatial = radius / 2;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const centerValue = image.data[idx];
        
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const neighborValue = image.data[ny * width + nx];
              
              // Spatial distance weight
              const spatialDist = Math.sqrt(dx * dx + dy * dy);
              const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * sigmaSpatial * sigmaSpatial));
              
              // Intensity similarity weight
              const intensityDiff = neighborValue - centerValue;
              const intensityWeight = Math.exp(-(intensityDiff * intensityDiff) / (2 * sigmaIntensity * sigmaIntensity));
              
              // Combined weight
              const weight = spatialWeight * intensityWeight;
              weightedSum += neighborValue * weight;
              weightSum += weight;
            }
          }
        }
        
        output.data[idx] = weightedSum / weightSum;
      }
    }
    
    return output;
  }
}

/**
 * Hysteresis threshold strategy (from Canny edge detection)
 * Uses two thresholds to produce connected edge traces:
 * - Strong edges (above epsilonHigh) are always kept
 * - Weak edges (between epsilonLow and epsilonHigh) are kept only if connected to strong edges
 * - Values below epsilonLow are discarded
 */
export class HysteresisThresholdStrategy implements ThresholdStrategy {
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage {
    const epsilonHigh = config.epsilonHigh ?? config.epsilon + 0.2;
    const epsilonLow = config.epsilonLow ?? config.epsilon - 0.2;
    const output = createChannelImage(sharpened.width, sharpened.height);
    const { width, height } = sharpened;
    
    // Step 1: Identify strong and weak edges
    const edgeMap = createChannelImage(width, height);
    const visited = new Uint8Array(width * height);
    
    for (let i = 0; i < width * height; i++) {
      const value = sharpened.data[i];
      if (value >= epsilonHigh) {
        edgeMap.data[i] = 1.0; // Strong edge
      } else if (value >= epsilonLow) {
        edgeMap.data[i] = 0.5; // Weak edge
      } else {
        edgeMap.data[i] = 0.0; // Not an edge
      }
    }
    
    // Step 2: Extend from strong edges using flood fill
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (edgeMap.data[idx] === 1.0 && !visited[idx]) {
          this.floodFill(edgeMap, visited, x, y, width, height);
        }
      }
    }
    
    // Step 3: Convert to final output (strong edges and connected weak edges)
    for (let i = 0; i < width * height; i++) {
      output.data[i] = edgeMap.data[i] === 1.0 ? 1.0 : 0.0;
    }
    
    return output;
  }
  
  /**
   * Flood fill to connect weak edges to strong edges
   */
  private floodFill(
    edgeMap: ChannelImage,
    visited: Uint8Array,
    startX: number,
    startY: number,
    width: number,
    height: number
  ): void {
    const queue: Array<[number, number]> = [[startX, startY]];
    visited[startY * width + startX] = 1;
    
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      
      // Check 8-connected neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          
          const nx = x + dx;
          const ny = y + dy;
          const idx = ny * width + nx;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[idx]) {
            if (edgeMap.data[idx] >= 0.5) { // Weak or strong edge
              edgeMap.data[idx] = 1.0; // Convert weak edge to strong
              visited[idx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }
    }
  }
}