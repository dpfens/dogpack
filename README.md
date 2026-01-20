# XDoG / FDoG Line Drawing Library

A TypeScript implementation of Extended Difference-of-Gaussians (XDoG) and Flow-based Difference-of-Gaussians (FDoG) algorithms for artistic line drawing and edge stylization.

## Overview

This library provides two main algorithms:

- **XDoG**: Uses standard isotropic Gaussian blur. Fast and good for general edge detection.
- **FDoG**: Uses flow-guided blur along edge tangent directions. Produces smoother, more coherent lines similar to hand-drawn illustrations.

## Installation

```bash
npm install xfdog
```

## Quick Start

### Basic XDoG

```typescript
import { XDoG } from 'xdog';

// Create processor with default settings
const xdog = new XDoG();

// Process canvas ImageData
const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

const result = xdog.processImageData(imageData);
ctx.putImageData(result, 0, 0);
```

### FDoG for Coherent Lines

```typescript
import { FDoG } from 'xdog';

const fdog = new FDoG({
  sigma: 1.0,
  phi: 10,
  etfIterations: 3,  // More iterations = smoother flow
});

const result = fdog.processImageData(imageData);
```

### Custom Configuration

```typescript
import { XDoG } from 'xdog';

const xdog = new XDoG({
  sigma: 1.5,      // Base blur size
  k: 1.6,          // Ratio between blur sizes
  tau: 0.98,       // Edge sensitivity
  epsilon: 0.5,    // Threshold point
  phi: 20,         // Threshold sharpness (higher = sharper edges)
});

// Override parameters per-call
const result = xdog.processImageData(imageData, { phi: 5 });
```

## Configuration Parameters

### DoG Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sigma`   | 1.0     | Base Gaussian blur standard deviation |
| `k`       | 1.6     | Ratio between the two blur sizes |
| `tau`     | 0.98    | Subtraction weight (controls edge sensitivity) |
| `epsilon` | 0.5     | Threshold for white vs. black transition |
| `phi`     | 10.0    | Sharpness of soft threshold (higher = more binary) |

### FDoG-specific Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `etfIterations` | 3 | Edge Tangent Flow refinement iterations |
| `etfKernelSize` | 5 | Smoothing kernel size for structure tensor |

## Architecture

The library uses a composition-based design that separates concerns:

```
┌─────────────────────────────────────────────────────┐
│                    XDoG / FDoG                      │  High-level API
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                  DoGProcessor                        │  Core algorithm
└─────────────────────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
┌──────────────────────┐   ┌──────────────────────┐
│   IsotropicBlur      │   │   FlowGuidedBlur     │   Blur strategies
└──────────────────────┘   └──────────────────────┘
                                      │
                                      ▼
                           ┌──────────────────────┐
                           │   EdgeTangentFlow    │   Flow field
                           └──────────────────────┘
```

### Extending with Custom Blur Strategies

You can implement the `BlurStrategy` interface for custom effects:

```typescript
import { BlurStrategy, DoGProcessor, GrayscaleImage } from 'xdog';

class MyCustomBlur implements BlurStrategy {
  blur(input: GrayscaleImage, sigma: number): GrayscaleImage {
    // Your implementation
  }
}

const processor = new DoGProcessor(new MyCustomBlur(), { sigma: 1.0 });
```

### Checking Strategy Availability

Each blur strategy has a static `isSupported()` method to check runtime availability.
This is particularly useful for GPU-accelerated implementations:

```typescript
import { IsotropicBlur, FlowGuidedBlur } from 'xdog';

// Pure JS implementations are always supported
console.log(IsotropicBlur.isSupported()); // true
console.log(FlowGuidedBlur.isSupported()); // true

// Future GPU implementations might not be
// if (WebGLIsotropicBlur.isSupported()) {
//   blur = new WebGLIsotropicBlur();
// } else {
//   console.warn(WebGLIsotropicBlur.getUnsupportedReason());
//   blur = new IsotropicBlur(); // fallback
// }
```

When implementing custom strategies, include the static methods:

```typescript
class WebGLBlur implements BlurStrategy {
  static isSupported(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  }
  
  static getUnsupportedReason(): string | undefined {
    if (!this.isSupported()) {
      return 'WebGL is not available in this browser';
    }
    return undefined;
  }
  
  blur(input: GrayscaleImage, sigma: number): GrayscaleImage {
    // WebGL implementation
  }
}
```

## Working with Grayscale Images

For performance-critical applications, work with grayscale images directly:

```typescript
import { 
  XDoG, 
  imageDataToGrayscale, 
  grayscaleToImageData,
  createGrayscaleImage 
} from 'xdog';

// Convert from ImageData
const grayscale = imageDataToGrayscale(imageData);

// Process
const xdog = new XDoG();
const result = xdog.process(grayscale);

// Convert back
const outputImageData = grayscaleToImageData(result);
```

## Visualizing Edge Tangent Flow

For FDoG, you can extract and visualize the flow field:

```typescript
import { FDoG, imageDataToGrayscale } from 'xdog';

const fdog = new FDoG();
const grayscale = imageDataToGrayscale(imageData);

// Get the ETF separately
const etf = fdog.computeETF(grayscale);

// Visualize tangent directions (example)
for (let y = 0; y < height; y += 10) {
  for (let x = 0; x < width; x += 10) {
    const tangent = etf.getTangent(x, y);
    // Draw a short line segment in the tangent direction
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + tangent.x * 5, y + tangent.y * 5);
    ctx.stroke();
  }
}
```

## Performance Notes

- **XDoG** is fast enough for real-time use on most modern devices
- **FDoG** is more expensive due to ETF computation and line integral convolution
- For video processing with FDoG, consider:
  - Computing ETF on keyframes and interpolating
  - Using `processWithETF()` with a shared flow field
  - Downscaling for ETF computation

## GPU Acceleration

The library provides WebGL and WebGPU implementations for significantly faster processing.

### WebGL (Broad Browser Support)

```typescript
import { 
  WebGLIsotropicBlur, 
  WebGLFlowGuidedBlur,
  DoGProcessor 
} from 'xdog';

// Check support
if (WebGLIsotropicBlur.isSupported()) {
  const blur = new WebGLIsotropicBlur();
  const processor = new DoGProcessor(blur, { sigma: 1.0 });
  
  const result = processor.process(grayscaleImage);
  
  // Clean up when done
  blur.dispose();
} else {
  console.warn(WebGLIsotropicBlur.getUnsupportedReason());
}
```

### WebGPU (Best Performance, Limited Support)

WebGPU operations are asynchronous:

```typescript
import { 
  WebGPUIsotropicBlur,
  WebGPUFlowGuidedBlur 
} from 'xdog';

// Check support (sync check for API presence)
if (WebGPUIsotropicBlur.isSupported()) {
  // Async check for actual device availability
  const available = await WebGPUIsotropicBlur.isAvailable();
  
  if (available) {
    const blur = new WebGPUIsotropicBlur();
    
    // Must use async method
    const blurred = await blur.blurAsync(grayscaleImage, 1.0);
    
    blur.dispose();
  }
}
```

### Automatic Fallback Pattern

```typescript
import {
  BlurStrategy,
  WebGPUIsotropicBlur,
  WebGLIsotropicBlur,
  IsotropicBlur,
  DoGProcessor,
} from 'xdog';

async function createOptimalProcessor(): Promise<DoGProcessor> {
  let blur: BlurStrategy;
  
  // Try WebGPU first (fastest)
  if (WebGPUIsotropicBlur.isSupported() && await WebGPUIsotropicBlur.isAvailable()) {
    console.log('Using WebGPU acceleration');
    blur = new WebGPUIsotropicBlur();
  }
  // Fall back to WebGL
  else if (WebGLIsotropicBlur.isSupported()) {
    console.log('Using WebGL acceleration');
    blur = new WebGLIsotropicBlur();
  }
  // Fall back to CPU
  else {
    console.log('Using CPU implementation');
    blur = new IsotropicBlur();
  }
  
  return new DoGProcessor(blur, { sigma: 1.0, phi: 10 });
}
```

### GPU Implementation Notes

| Feature | WebGL | WebGPU |
|---------|-------|--------|
| Browser Support | Wide | Chrome 113+, Edge 113+ |
| API | Synchronous | Asynchronous |
| Max Kernel Size | 63 | 127 |
| Performance | Good | Best |
| `blur()` method | ✓ Sync | ✗ Use `blurAsync()` |

**Important**: WebGPU implementations require async usage. The synchronous `blur()` 
method will throw an error - use `blurAsync()` instead.

## References

- Winnemöller, H. (2011). "XDoG: Advanced image stylization with eXtended Difference-of-Gaussians"
- Kang, H., Lee, S., & Chui, C. K. (2007). "Coherent line drawing"
- Kyprianidis, J. E., & Döllner, J. (2008). "Image abstraction by structure adaptive filtering"

## License

MIT
