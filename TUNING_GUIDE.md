# XDoG/FDoG Parameter Tuning Guide

## Preprocessing (Important!)

Real-world photos often contain texture (grass, fabric, sand, skin pores) that creates noisy output. **Preprocessing is essential for clean results.**

### Quick Start with Preprocessing

```typescript
import { 
  XDoG, 
  imageDataToGrayscale, 
  grayscaleToImageData,
  PreprocessingPresets,
  bilateralFilter 
} from 'xdog';

// Convert your image
const grayscale = imageDataToGrayscale(canvasImageData);

// Apply preprocessing (choose one based on your image)
const cleaned = PreprocessingPresets.standard(grayscale);  // Most photos
// const cleaned = PreprocessingPresets.nature(grayscale); // Grass, foliage, landscapes
// const cleaned = PreprocessingPresets.heavy(grayscale);  // Very textured images
// const cleaned = PreprocessingPresets.artistic(grayscale); // Painterly look

// Then process with XDoG
const xdog = new XDoG({ sigma: 0.5, k: 1.6, tau: 0.99, epsilon: 0, phi: 100 });
const result = await xdog.process(cleaned);
```

### Preprocessing Presets

| Preset | Best For | Description |
|--------|----------|-------------|
| `light` | Clean studio photos, illustrations | Minimal smoothing |
| `standard` | Most outdoor photos, portraits | Balanced smoothing |
| `heavy` | Very textured images (fabric, detailed backgrounds) | Aggressive noise removal |
| `nature` | Landscapes, grass, foliage, beaches | Removes natural texture while keeping edges |
| `artistic` | Stylized/painterly output | Kuwahara + bilateral for flat regions |

### Custom Preprocessing Pipeline

```typescript
import { Preprocessor, bilateralFilter } from 'xdog';

// Method 1: Use the Preprocessor class for chaining
const preprocessor = new Preprocessor()
  .bilateral({ sigmaSpatial: 6, sigmaRange: 0.15 })
  .bilateral({ sigmaSpatial: 4, sigmaRange: 0.1 });

const cleaned = preprocessor.apply(grayscale);

// Method 2: Call filters directly
let cleaned = bilateralFilter(grayscale, { sigmaSpatial: 5, sigmaRange: 0.12 });
cleaned = bilateralFilter(cleaned, { sigmaSpatial: 3, sigmaRange: 0.08 });
```

### Bilateral Filter Parameters

The bilateral filter is the most important preprocessing tool. It smooths texture while preserving edges.

| Parameter | Range | Effect |
|-----------|-------|--------|
| `sigmaSpatial` | 2-10 | Size of smoothing neighborhood. Higher = more smoothing |
| `sigmaRange` | 0.05-0.2 | Sensitivity to intensity differences. Higher = edges get smoothed too |

**Tips:**
- Start with `sigmaSpatial: 4, sigmaRange: 0.1`
- For more smoothing, increase `sigmaSpatial` (not `sigmaRange`)
- Multiple passes often work better than one aggressive pass

### Other Preprocessing Filters

```typescript
import { medianFilter, kuwaharaFilter, gaussianBlur, enhanceContrast, quantize } from 'xdog';

// Median filter - removes salt-and-pepper noise
const cleaned = medianFilter(grayscale, { radius: 2 });

// Kuwahara filter - creates painterly flat regions
const painterly = kuwaharaFilter(grayscale, { radius: 4 });

// Contrast enhancement - makes edges more distinct
const enhanced = enhanceContrast(grayscale, 0.01, 0.99);

// Quantize - reduces intensity levels (posterize effect)
const posterized = quantize(grayscale, 8);
```

---

## Quick Start - Best Presets

### 🏆 "Clean" (Recommended Default)
```javascript
{
  sigma: 0.5,
  k: 1.6,
  tau: 0.99,
  epsilon: 0,
  phi: 100
}
```
Best for: Most photos, product shots, architecture

### ✏️ "Sketch"
```javascript
{
  sigma: 0.4,
  k: 1.4,
  tau: 0.985,
  epsilon: -0.01,
  phi: 50
}
```
Best for: Portraits, softer artistic look

### 📖 "Manga"
```javascript
{
  sigma: 0.6,
  k: 1.8,
  tau: 0.995,
  epsilon: 0.005,
  phi: 300
}
```
Best for: High contrast illustration style

---

## Parameter Deep Dive

### Sigma (σ) - Blur Radius
**Range: 0.3 - 3.0 | Default: 0.5**

Controls the scale of detected edges:
- **Lower (0.3-0.5)**: Captures fine details, more texture
- **Higher (1.0-3.0)**: Only major edges, smoother result

*Tip: Start at 0.5, increase if too noisy*

### K - Blur Ratio  
**Range: 1.1 - 5.0 | Default: 1.6**

Ratio between the two Gaussian blurs:
- **Lower (1.1-1.4)**: Thinner lines, more detail
- **Higher (2.0-5.0)**: Thicker, bolder strokes

*Tip: 1.6 is the "golden ratio" from the original paper*

### Tau (τ) - Edge Sensitivity
**Range: 0.9 - 1.1 | Default: 0.99**

Controls how much the second blur subtracts:
- **< 1.0**: More sensitive, captures subtle edges
- **= 1.0**: Balanced
- **> 1.0**: Less sensitive, only strong edges

*Tip: Small changes have big effects! Adjust by 0.01*

### Epsilon (ε) - Threshold
**Range: -0.1 - 0.1 | Default: 0**

The cutoff between white and black:
- **Negative**: More black areas (more lines visible)
- **Zero**: Balanced
- **Positive**: More white areas (cleaner, fewer lines)

*Tip: Adjust to control overall "darkness" of result*

### Phi (φ) - Sharpness
**Range: 1 - 500 | Default: 100**

Controls the softness of the threshold transition:
- **Low (1-30)**: Soft, gradient transitions (pencil-like)
- **Medium (50-150)**: Balanced
- **High (200-500)**: Hard, crisp black/white (ink-like)

*Tip: Higher phi = more "graphic" look*

---

## Troubleshooting

### Problem: Too much noise/texture
**Solution:**
- Increase `sigma` (0.6-0.8)
- Increase `epsilon` (0.01-0.02)
- Increase `phi` (150-200)

### Problem: Lines too faint/thin
**Solution:**
- Decrease `epsilon` (-0.02)
- Increase `k` (1.8-2.0)
- Decrease `tau` (0.98)

### Problem: Lost fine details
**Solution:**
- Decrease `sigma` (0.3-0.4)
- Decrease `k` (1.3-1.5)
- Decrease `phi` (30-50)

### Problem: Result looks muddy/gray
**Solution:**
- Increase `phi` (200+)
- Adjust `epsilon` towards 0

---

## XDoG vs FDoG

### XDoG (Extended Difference of Gaussians)
- **Speed**: Fast ⚡
- **Best for**: General use, quick results
- **Characteristic**: Isotropic (uniform) blur in all directions

### FDoG (Flow-based Difference of Gaussians)
- **Speed**: Slower (3-5x)
- **Best for**: Portraits, organic subjects
- **Characteristic**: Blurs along edge tangent direction, creating smoother, more coherent lines that follow the natural flow of the image

*Use FDoG when you want that hand-drawn illustration quality!*
