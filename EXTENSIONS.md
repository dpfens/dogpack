# XDoG/FDoG Extensions and Custom Effects

This guide covers advanced techniques for extending the library beyond its built-in presets. Many of these approaches are based on methods described in Section 5 of the Winnemöller paper and related research, adapted for practical implementation.

## Hatching and Cross-Hatching

The paper describes a hatching approach based on the concept of tonal art maps, where layers of strokes add up to achieve a desired tone. The technique uses multiple XDoG threshold results as masks for hatching textures, producing results that combine the XDoG's edge-awareness with traditional hatching aesthetics.

### Basic Hatching Pipeline

The fundamental idea is to compute several threshold images at different ε values, use each as a mask for a hatching texture layer, and composite them together. Darker regions in the original image activate more hatching layers:

```typescript
import { 
  XDoG, 
  imageDataToGrayscale, 
  grayscaleToImageData,
  createGrayscaleImage,
  PreprocessingPresets 
} from 'xdog';

interface HatchingOptions {
  // Number of hatching layers (more layers = finer tonal gradation)
  layers: number;
  // Base XDoG parameters
  sigma: number;
  k: number;
  p: number;
  phi: number;
  // Hatching texture (grayscale, normalized 0-1)
  hatchTexture: GrayscaleImage;
  // Optional: rotation angle for each layer (in radians)
  layerRotations?: number[];
}

async function applyHatching(
  input: ImageData,
  options: HatchingOptions
): Promise<ImageData> {
  const { layers, sigma, k, p, phi, hatchTexture, layerRotations } = options;
  
  const grayscale = imageDataToGrayscale(input);
  const cleaned = PreprocessingPresets.standard(grayscale);
  
  const { width, height } = grayscale;
  
  // Create XDoG processor with high phi for clean thresholds
  const xdog = new XDoG({ sigma, k, p, phi, epsilon: 0.5 });
  
  // Compute threshold masks at different epsilon values
  // Lower epsilon = darker threshold = more area marked as "dark"
  const masks: GrayscaleImage[] = [];
  for (let i = 0; i < layers; i++) {
    // Distribute epsilon values from dark (low) to light (high)
    const epsilon = 0.3 + (i / (layers - 1)) * 0.5;
    const mask = await xdog.process(cleaned, { epsilon });
    masks.push(mask);
  }
  
  // Start with white canvas
  const result = createGrayscaleImage(width, height);
  result.data.fill(1.0);
  
  // Apply each hatching layer where its mask is dark
  for (let i = 0; i < layers; i++) {
    const mask = masks[i];
    const rotation = layerRotations?.[i] ?? (i * Math.PI / layers);
    
    // Sample hatching texture with rotation
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const maskValue = mask.data[idx];
        
        // Only apply hatching where mask is dark (below threshold)
        if (maskValue < 0.5) {
          // Rotate sampling coordinates
          const cos = Math.cos(rotation);
          const sin = Math.sin(rotation);
          const tx = (x * cos - y * sin) % hatchTexture.width;
          const ty = (x * sin + y * cos) % hatchTexture.height;
          
          // Wrap to positive coordinates
          const sx = ((tx % hatchTexture.width) + hatchTexture.width) % hatchTexture.width;
          const sy = ((ty % hatchTexture.height) + hatchTexture.height) % hatchTexture.height;
          
          const hatchIdx = Math.floor(sy) * hatchTexture.width + Math.floor(sx);
          const hatchValue = hatchTexture.data[hatchIdx];
          
          // Multiply hatching onto result (darker hatching = darker result)
          result.data[idx] = Math.min(result.data[idx], hatchValue);
        }
      }
    }
  }
  
  return grayscaleToImageData(result);
}
```

### Creating Hatching Textures

The quality of hatching results depends heavily on the texture used. You can create hatching textures programmatically or scan real pen strokes:

```typescript
import { createGrayscaleImage } from 'xdog';

// Create a simple diagonal line hatching texture
function createDiagonalHatchTexture(
  size: number, 
  lineWidth: number, 
  spacing: number
): GrayscaleImage {
  const texture = createGrayscaleImage(size, size);
  texture.data.fill(1.0); // White background
  
  // Draw diagonal lines
  for (let i = -size; i < size * 2; i += spacing) {
    for (let t = 0; t < size; t++) {
      const x = t;
      const y = i + t;
      
      if (y >= 0 && y < size) {
        // Draw line with some width
        for (let w = -lineWidth / 2; w <= lineWidth / 2; w++) {
          const wx = Math.floor(x + w);
          const wy = Math.floor(y);
          if (wx >= 0 && wx < size && wy >= 0 && wy < size) {
            texture.data[wy * size + wx] = 0.0; // Black line
          }
        }
      }
    }
  }
  
  return texture;
}

// Create cross-hatching by overlaying two diagonal textures
function createCrossHatchTexture(
  size: number,
  lineWidth: number,
  spacing: number
): GrayscaleImage {
  const texture = createGrayscaleImage(size, size);
  texture.data.fill(1.0);
  
  // First diagonal (top-left to bottom-right)
  for (let i = -size; i < size * 2; i += spacing) {
    for (let t = 0; t < size; t++) {
      const x = t;
      const y = i + t;
      if (y >= 0 && y < size) {
        for (let w = -lineWidth / 2; w <= lineWidth / 2; w++) {
          const wx = Math.floor(x + w);
          if (wx >= 0 && wx < size) {
            texture.data[y * size + wx] = 0.0;
          }
        }
      }
    }
  }
  
  // Second diagonal (top-right to bottom-left)
  for (let i = -size; i < size * 2; i += spacing) {
    for (let t = 0; t < size; t++) {
      const x = t;
      const y = i + (size - 1 - t);
      if (y >= 0 && y < size) {
        for (let w = -lineWidth / 2; w <= lineWidth / 2; w++) {
          const wx = Math.floor(x + w);
          if (wx >= 0 && wx < size) {
            texture.data[y * size + wx] = 0.0;
          }
        }
      }
    }
  }
  
  return texture;
}
```

### Flow-Aligned Hatching

For more sophisticated results, you can align hatching strokes with the Edge Tangent Flow field. This produces hatching that follows the contours of the subject, similar to how a skilled artist would draw:

```typescript
import { FDoG, EdgeTangentFlow, imageDataToGrayscale, createGrayscaleImage } from 'xdog';

async function flowAlignedHatching(
  input: ImageData,
  options: {
    strokeLength: number;
    strokeSpacing: number;
    layers: number;
    sigmaC: number;
  }
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  const { width, height } = grayscale;
  
  // Compute ETF for flow direction
  const fdog = new FDoG({ sigmaC: options.sigmaC });
  const etf = fdog.computeETF(grayscale);
  
  // Compute luminance thresholds for layer activation
  const xdog = new XDoG({ sigma: 1.0, p: 20, phi: 100 });
  const masks: GrayscaleImage[] = [];
  for (let i = 0; i < options.layers; i++) {
    const epsilon = 0.2 + (i / (options.layers - 1)) * 0.6;
    masks.push(await xdog.process(grayscale, { epsilon }));
  }
  
  // Start with white canvas
  const result = createGrayscaleImage(width, height);
  result.data.fill(1.0);
  
  // Place strokes on a grid, following flow direction
  for (let gy = 0; gy < height; gy += options.strokeSpacing) {
    for (let gx = 0; gx < width; gx += options.strokeSpacing) {
      // Determine how many layers should contribute at this point
      let activeLayers = 0;
      for (let i = 0; i < options.layers; i++) {
        if (masks[i].data[gy * width + gx] < 0.5) {
          activeLayers++;
        }
      }
      
      if (activeLayers === 0) continue;
      
      // Draw strokes along flow direction
      const tangent = etf.getTangent(gx, gy);
      
      // Draw primary stroke
      drawFlowStroke(result, gx, gy, tangent.x, tangent.y, options.strokeLength);
      
      // For darker regions, add cross-hatching (perpendicular strokes)
      if (activeLayers > options.layers / 2) {
        drawFlowStroke(result, gx, gy, -tangent.y, tangent.x, options.strokeLength * 0.7);
      }
    }
  }
  
  return grayscaleToImageData(result);
}

function drawFlowStroke(
  image: GrayscaleImage,
  startX: number,
  startY: number,
  dx: number,
  dy: number,
  length: number
): void {
  const halfLength = length / 2;
  
  for (let t = -halfLength; t <= halfLength; t++) {
    const x = Math.round(startX + dx * t);
    const y = Math.round(startY + dy * t);
    
    if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
      image.data[y * image.width + x] = 0.0;
    }
  }
}
```

## Multi-Scale Edge Detection

The paper discusses abstraction through varying the σ parameter—larger spatial support removes fine detail, leaving only major forms. You can combine multiple scales to create images that show both broad structure and fine detail:

```typescript
import { XDoG, imageDataToGrayscale, grayscaleToImageData, createGrayscaleImage } from 'xdog';

interface MultiScaleOptions {
  scales: Array<{
    sigma: number;
    weight: number;  // Contribution of this scale to final result
    epsilon: number;
  }>;
  p: number;
  phi: number;
}

async function multiScaleEdges(
  input: ImageData,
  options: MultiScaleOptions
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  const { width, height } = grayscale;
  
  const result = createGrayscaleImage(width, height);
  result.data.fill(0); // Start black, accumulate white
  
  let totalWeight = 0;
  
  for (const scale of options.scales) {
    const xdog = new XDoG({
      sigma: scale.sigma,
      k: 1.6,
      p: options.p,
      epsilon: scale.epsilon,
      phi: options.phi
    });
    
    const scaleResult = await xdog.process(grayscale);
    
    // Accumulate weighted contribution
    for (let i = 0; i < result.data.length; i++) {
      result.data[i] += scaleResult.data[i] * scale.weight;
    }
    totalWeight += scale.weight;
  }
  
  // Normalize by total weight
  for (let i = 0; i < result.data.length; i++) {
    result.data[i] /= totalWeight;
  }
  
  return grayscaleToImageData(result);
}

// Example: Combine fine detail with broad strokes
const multiScaleResult = await multiScaleEdges(imageData, {
  scales: [
    { sigma: 0.5, weight: 0.3, epsilon: 0.6 },  // Fine detail
    { sigma: 1.4, weight: 0.5, epsilon: 0.7 },  // Medium features
    { sigma: 4.0, weight: 0.2, epsilon: 0.8 },  // Broad structure
  ],
  p: 25,
  phi: 80
});
```

## Negative Edges and Inverted Regions

Section 3.4 of the paper discusses negative edges—white edges that appear in dark regions of the image. The XDoG naturally produces both black edges (in light areas) and white edges (in dark areas) because the DoG response can be either positive or negative. You can emphasize or isolate these negative edges for dramatic effect:

```typescript
import { XDoG, DoGProcessor, IsotropicBlur, imageDataToGrayscale, createGrayscaleImage } from 'xdog';

async function extractNegativeEdges(
  input: ImageData,
  options: { sigma: number; k: number; p: number }
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  
  // Get the raw sharpened image (before thresholding)
  const blur = new IsotropicBlur();
  const processor = new DoGProcessor(blur, options);
  const sharpened = await processor.processNoThreshold(grayscale);
  
  const { width, height } = grayscale;
  const result = createGrayscaleImage(width, height);
  
  // Extract only the negative (white) edges in dark regions
  for (let i = 0; i < sharpened.data.length; i++) {
    const originalValue = grayscale.data[i];
    const sharpenedValue = sharpened.data[i];
    
    // Negative edge: sharpened value exceeds original in a dark region
    if (originalValue < 0.4 && sharpenedValue > originalValue + 0.1) {
      result.data[i] = 1.0; // White edge
    } else {
      result.data[i] = 0.0; // Black background
    }
  }
  
  return grayscaleToImageData(result);
}

// Composite negative edges with standard edges for the full Winnemöller effect
async function compositeWithNegativeEdges(
  input: ImageData,
  options: { sigma: number; k: number; p: number; epsilon: number; phi: number }
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  
  // Standard XDoG (produces both positive and negative edges naturally)
  const xdog = new XDoG(options);
  const result = await xdog.process(grayscale);
  
  // The standard XDoG already includes negative edges via the soft threshold
  // For emphasis, we can boost contrast in dark regions
  for (let i = 0; i < result.data.length; i++) {
    const original = grayscale.data[i];
    
    // In dark regions, increase contrast of the result
    if (original < 0.3) {
      result.data[i] = result.data[i] > 0.5 ? 1.0 : result.data[i] * 0.5;
    }
  }
  
  return grayscaleToImageData(result);
}
```

## Custom Threshold Functions

The paper mentions that the soft threshold function T_ε,φ is just one of many luminance adjustments that can be applied to the sharpened image. Section 2.5 and Figure 7 show alternative functions including three-tone quantization. You can implement custom threshold functions for specialized effects:

```typescript
import { DoGProcessor, IsotropicBlur, imageDataToGrayscale, createGrayscaleImage, grayscaleToImageData } from 'xdog';

type ThresholdFunction = (value: number, params: Record<string, number>) => number;

// Three-tone threshold: white, gray, black
const threeToneThreshold: ThresholdFunction = (value, params) => {
  const { highThreshold, lowThreshold } = params;
  if (value >= highThreshold) return 1.0;
  if (value >= lowThreshold) return 0.5;
  return 0.0;
};

// Smooth three-tone (as shown in Figure 7c of the paper)
const smoothThreeToneThreshold: ThresholdFunction = (value, params) => {
  const { epsilon, phi } = params;
  const upper = 1.0 + Math.tanh(phi * (value - epsilon));
  const lower = 0.5 * (1.0 + Math.tanh(phi * (value - epsilon * 0.5)));
  return Math.max(0, Math.min(1, lower * 0.5 + upper * 0.5));
};

// Posterization threshold: quantize to N levels
const posterizeThreshold: ThresholdFunction = (value, params) => {
  const { levels } = params;
  const step = 1.0 / (levels - 1);
  return Math.round(Math.max(0, Math.min(1, value)) / step) * step;
};

// Inverted threshold: flip black and white
const invertedThreshold: ThresholdFunction = (value, params) => {
  const { epsilon, phi } = params;
  if (value >= epsilon) return 0.0;
  return -Math.tanh(phi * (value - epsilon));
};

async function applyCustomThreshold(
  input: ImageData,
  dogParams: { sigma: number; k: number; p: number },
  thresholdFn: ThresholdFunction,
  thresholdParams: Record<string, number>
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  
  const blur = new IsotropicBlur();
  const processor = new DoGProcessor(blur, dogParams);
  const sharpened = await processor.processNoThreshold(grayscale);
  
  const result = createGrayscaleImage(sharpened.width, sharpened.height);
  
  for (let i = 0; i < sharpened.data.length; i++) {
    result.data[i] = thresholdFn(sharpened.data[i], thresholdParams);
  }
  
  return grayscaleToImageData(result);
}

// Example: Three-tone sketch effect
const threeToneResult = await applyCustomThreshold(
  imageData,
  { sigma: 1.2, k: 1.6, p: 25 },
  threeToneThreshold,
  { highThreshold: 0.7, lowThreshold: 0.4 }
);

// Example: Posterized edges with 5 levels
const posterizedResult = await applyCustomThreshold(
  imageData,
  { sigma: 1.0, k: 1.6, p: 20 },
  posterizeThreshold,
  { levels: 5 }
);
```

## Motion Effects: Speed Lines and Ghosting

Section 3.3 of the paper discusses how motion can be suggested through speed lines and ghosting. Speed lines emerge naturally when applying DoG to motion-blurred images—horizontal motion blur removes vertical edges, leaving only horizontal features that read as speed lines. You can simulate this effect:

```typescript
import { XDoG, imageDataToGrayscale, createGrayscaleImage, grayscaleToImageData } from 'xdog';

// Apply directional motion blur before XDoG for speed line effect
function directionalBlur(
  image: GrayscaleImage,
  angle: number,  // Direction in radians
  length: number  // Blur length in pixels
): GrayscaleImage {
  const { width, height } = image;
  const result = createGrayscaleImage(width, height);
  
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const halfLength = Math.floor(length / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      
      for (let t = -halfLength; t <= halfLength; t++) {
        const sx = Math.round(x + dx * t);
        const sy = Math.round(y + dy * t);
        
        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          sum += image.data[sy * width + sx];
          count++;
        }
      }
      
      result.data[y * width + x] = sum / count;
    }
  }
  
  return result;
}

async function speedLineEffect(
  input: ImageData,
  options: {
    motionAngle: number;   // Direction of motion (radians, 0 = horizontal right)
    motionLength: number;  // Length of motion blur
    xdogParams: { sigma: number; p: number; epsilon: number; phi: number };
  }
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  
  // Apply directional blur to simulate motion
  const blurred = directionalBlur(grayscale, options.motionAngle, options.motionLength);
  
  // Apply XDoG to the motion-blurred image
  const xdog = new XDoG(options.xdogParams);
  const result = await xdog.process(blurred);
  
  return grayscaleToImageData(result);
}

// Ghosting effect: offset duplicates with decreasing opacity
async function ghostingEffect(
  input: ImageData,
  options: {
    ghosts: number;        // Number of ghost copies
    offsetX: number;       // X offset per ghost
    offsetY: number;       // Y offset per ghost
    fadeRate: number;      // Opacity multiplier per ghost (0-1)
    xdogParams: { sigma: number; p: number; epsilon: number; phi: number };
  }
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  const { width, height } = grayscale;
  
  // Create composite with ghosts
  const composite = createGrayscaleImage(width, height);
  composite.data.fill(1.0); // White background
  
  const xdog = new XDoG(options.xdogParams);
  const baseResult = await xdog.process(grayscale);
  
  // Add ghosts from back to front
  for (let g = options.ghosts - 1; g >= 0; g--) {
    const opacity = Math.pow(options.fadeRate, g);
    const ox = Math.round(options.offsetX * g);
    const oy = Math.round(options.offsetY * g);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = x - ox;
        const sy = y - oy;
        
        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          const srcIdx = sy * width + sx;
          const dstIdx = y * width + x;
          
          // Blend ghost onto composite
          const ghostValue = baseResult.data[srcIdx];
          composite.data[dstIdx] = composite.data[dstIdx] * (1 - opacity * (1 - ghostValue)) 
                                 + ghostValue * opacity * (1 - ghostValue);
        }
      }
    }
  }
  
  // Add the main (non-ghosted) image on top
  for (let i = 0; i < baseResult.data.length; i++) {
    composite.data[i] = Math.min(composite.data[i], baseResult.data[i]);
  }
  
  return grayscaleToImageData(composite);
}
```

## Combining XDoG with Color

The paper primarily deals with grayscale edge images, but the results can be combined with color in various ways for final output:

```typescript
import { XDoG, imageDataToGrayscale, grayscaleToImageData } from 'xdog';

// Method 1: Multiply edges over original color
async function edgesOverColor(
  input: ImageData,
  xdogParams: { sigma: number; p: number; epsilon: number; phi: number }
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  const xdog = new XDoG(xdogParams);
  const edges = await xdog.process(grayscale);
  
  const result = new ImageData(input.width, input.height);
  
  for (let i = 0; i < edges.data.length; i++) {
    const edgeValue = edges.data[i];
    
    // Multiply original color by edge value (edges are dark, so they darken the color)
    result.data[i * 4] = Math.round(input.data[i * 4] * edgeValue);
    result.data[i * 4 + 1] = Math.round(input.data[i * 4 + 1] * edgeValue);
    result.data[i * 4 + 2] = Math.round(input.data[i * 4 + 2] * edgeValue);
    result.data[i * 4 + 3] = 255;
  }
  
  return result;
}

// Method 2: Edges as separate layer with color fill in white regions
async function colorFilledEdges(
  input: ImageData,
  xdogParams: { sigma: number; p: number; epsilon: number; phi: number },
  colorSaturation: number = 0.7  // How much to desaturate the color fill
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  const xdog = new XDoG(xdogParams);
  const edges = await xdog.process(grayscale);
  
  const result = new ImageData(input.width, input.height);
  
  for (let i = 0; i < edges.data.length; i++) {
    const edgeValue = edges.data[i];
    
    if (edgeValue > 0.5) {
      // White region: fill with desaturated original color
      const r = input.data[i * 4];
      const g = input.data[i * 4 + 1];
      const b = input.data[i * 4 + 2];
      
      // Simple desaturation toward the average
      const avg = (r + g + b) / 3;
      result.data[i * 4] = Math.round(avg + (r - avg) * colorSaturation);
      result.data[i * 4 + 1] = Math.round(avg + (g - avg) * colorSaturation);
      result.data[i * 4 + 2] = Math.round(avg + (b - avg) * colorSaturation);
    } else {
      // Dark region: black edge
      result.data[i * 4] = Math.round(edgeValue * 255);
      result.data[i * 4 + 1] = Math.round(edgeValue * 255);
      result.data[i * 4 + 2] = Math.round(edgeValue * 255);
    }
    result.data[i * 4 + 3] = 255;
  }
  
  return result;
}

// Method 3: Color quantization combined with edges (cel-shading style)
async function celShadedEffect(
  input: ImageData,
  xdogParams: { sigma: number; p: number; epsilon: number; phi: number },
  colorLevels: number = 4
): Promise<ImageData> {
  const grayscale = imageDataToGrayscale(input);
  const xdog = new XDoG(xdogParams);
  const edges = await xdog.process(grayscale);
  
  const result = new ImageData(input.width, input.height);
  
  // Quantize function for cel-shading
  const quantize = (value: number) => {
    const step = 255 / (colorLevels - 1);
    return Math.round(Math.round(value / step) * step);
  };
  
  for (let i = 0; i < edges.data.length; i++) {
    const edgeValue = edges.data[i];
    
    if (edgeValue > 0.9) {
      // White region: quantized color
      result.data[i * 4] = quantize(input.data[i * 4]);
      result.data[i * 4 + 1] = quantize(input.data[i * 4 + 1]);
      result.data[i * 4 + 2] = quantize(input.data[i * 4 + 2]);
    } else {
      // Edge region: black or very dark
      const darkness = Math.pow(edgeValue, 2); // Sharpen the edge
      result.data[i * 4] = Math.round(quantize(input.data[i * 4]) * darkness);
      result.data[i * 4 + 1] = Math.round(quantize(input.data[i * 4 + 1]) * darkness);
      result.data[i * 4 + 2] = Math.round(quantize(input.data[i * 4 + 2]) * darkness);
    }
    result.data[i * 4 + 3] = 255;
  }
  
  return result;
}
```

## Creating Custom Blur Strategies

The library's architecture allows you to implement custom blur strategies for specialized effects. Any class implementing the `BlurStrategy` interface can be used with the `DoGProcessor`:

```typescript
import { BlurStrategy, DoGProcessor, GrayscaleImage, createGrayscaleImage, getPixel } from 'xdog';

// Example: Radial blur for zoom/explosion effects
class RadialBlur implements BlurStrategy {
  constructor(
    private centerX: number,
    private centerY: number,
    private strength: number = 1.0
  ) {}
  
  static isSupported(): boolean {
    return true;
  }
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    const { width, height } = input;
    const output = createGrayscaleImage(width, height);
    
    const samples = Math.max(3, Math.ceil(sigma * 2));
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Direction from center
        const dx = x - this.centerX;
        const dy = y - this.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 1) {
          output.data[y * width + x] = getPixel(input, x, y);
          continue;
        }
        
        // Sample along radial direction
        const ndx = dx / dist;
        const ndy = dy / dist;
        
        let sum = 0;
        let weightSum = 0;
        
        for (let s = -samples; s <= samples; s++) {
          const t = s / samples * sigma * this.strength;
          const sx = x + ndx * t;
          const sy = y + ndy * t;
          
          const weight = Math.exp(-(t * t) / (2 * sigma * sigma));
          sum += getPixel(input, Math.round(sx), Math.round(sy)) * weight;
          weightSum += weight;
        }
        
        output.data[y * width + x] = sum / weightSum;
      }
    }
    
    return output;
  }
}

// Use custom blur with DoGProcessor
const radialBlur = new RadialBlur(imageData.width / 2, imageData.height / 2, 1.5);
const processor = new DoGProcessor(radialBlur, { sigma: 2.0, k: 1.6, p: 25, epsilon: 0.7, phi: 50 });
const result = await processor.process(grayscaleImage);
```

## Video Processing Considerations

When processing video frames, efficiency becomes critical. The paper mentions that for FDoG, the ETF can be computed on keyframes and interpolated for intermediate frames:

```typescript
import { FDoG, EdgeTangentFlow, GrayscaleImage } from 'xdog';

class VideoProcessor {
  private fdog: FDoG;
  private cachedETF: EdgeTangentFlow | null = null;
  private keyframeInterval: number;
  private frameCount: number = 0;
  
  constructor(
    fdogParams: Parameters<typeof FDoG.prototype.constructor>[0],
    keyframeInterval: number = 15  // Recompute ETF every N frames
  ) {
    this.fdog = new FDoG(fdogParams);
    this.keyframeInterval = keyframeInterval;
  }
  
  async processFrame(frame: GrayscaleImage): Promise<GrayscaleImage> {
    // Recompute ETF on keyframes
    if (this.frameCount % this.keyframeInterval === 0 || this.cachedETF === null) {
      this.cachedETF = this.fdog.computeETF(frame);
    }
    
    this.frameCount++;
    
    // Process frame with cached ETF
    return this.fdog.processWithETF(frame, this.cachedETF);
  }
  
  // For smoother results, interpolate ETF between keyframes
  async processFrameWithInterpolation(
    frame: GrayscaleImage,
    nextKeyframe: GrayscaleImage | null,
    progress: number  // 0-1, position between keyframes
  ): Promise<GrayscaleImage> {
    if (progress === 0 || this.cachedETF === null) {
      this.cachedETF = this.fdog.computeETF(frame);
    }
    
    // For now, just use the cached ETF
    // Full interpolation would require blending tangent fields
    return this.fdog.processWithETF(frame, this.cachedETF);
  }
}
```

## Tips for Parameter Exploration

When developing custom effects, systematic parameter exploration helps find good settings:

```typescript
import { XDoG, imageDataToGrayscale, grayscaleToImageData } from 'xdog';

// Generate a grid of results varying two parameters
async function parameterGrid(
  input: ImageData,
  baseParams: { sigma: number; k: number; p: number; epsilon: number; phi: number },
  param1: { name: keyof typeof baseParams; values: number[] },
  param2: { name: keyof typeof baseParams; values: number[] }
): Promise<ImageData[][]> {
  const grayscale = imageDataToGrayscale(input);
  const results: ImageData[][] = [];
  
  for (const v1 of param1.values) {
    const row: ImageData[] = [];
    for (const v2 of param2.values) {
      const params = {
        ...baseParams,
        [param1.name]: v1,
        [param2.name]: v2
      };
      
      const xdog = new XDoG(params);
      const result = await xdog.process(grayscale);
      row.push(grayscaleToImageData(result));
    }
    results.push(row);
  }
  
  return results;
}

// Example: Explore sigma vs phi space
const grid = await parameterGrid(
  imageData,
  { sigma: 1.0, k: 1.6, p: 20, epsilon: 0.7, phi: 10 },
  { name: 'sigma', values: [0.5, 1.0, 2.0, 4.0] },
  { name: 'phi', values: [0.01, 1, 10, 100] }
);
```

This guide covers the major extension points of the library. The underlying DoG operator is remarkably flexible—as the paper demonstrates, slight parameter modifications within a single operator can produce results spanning from soft pencil shading to dramatic woodcut, and the architecture supports further customization through blur strategies, threshold functions, and compositing techniques.