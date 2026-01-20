# XDoG/FDoG Parameter Tuning Guide

This guide provides a comprehensive understanding of parameter tuning for the XDoG and FDoG filters, drawing directly from the research described in Winnemöller et al.'s paper. Understanding the theoretical foundations helps tremendously when exploring the parameter space.

## Quick Start: Recommended Presets

For most use cases, starting with a preset and then fine-tuning produces faster results than configuring parameters from scratch.

### Line Art (Clean Black & White)

The threshold preset produces clean black-and-white line images suitable for comics, technical illustration, and graphic design. The high φ value creates a near step-function threshold that eliminates intermediate tones:

```typescript
import { XDoG, STYLE_PRESETS } from 'xdog';

const xdog = new XDoG(STYLE_PRESETS.threshold);
// Parameters: sigma: 1.4, k: 1.6, p: 20, epsilon: 0.78, phi: 100
```

This preset works well for most photos, product shots, architecture, and technical drawings where you want crisp, unambiguous black-and-white edges.

### Pencil Shading

The pencil shading preset creates images with high-frequency detail resembling graphite on paper. The small σ value captures fine texture, and the very low φ ensures soft, gradual tonal transitions:

```typescript
const xdog = new XDoG(STYLE_PRESETS.pencilShading);
// Parameters: sigma: 0.4, k: 1.6, p: 20, epsilon: 0.5, phi: 0.01
```

This works best for portraits and subjects where you want a soft, artistic look with gradual tonal variation rather than hard edges.

### Pastel

The pastel preset creates intermediate edge width with mostly white regions. The high ε threshold pushes most values to white while maintaining soft transitions:

```typescript
const xdog = new XDoG(STYLE_PRESETS.pastel);
// Parameters: sigma: 2.0, k: 1.6, p: 40, epsilon: 1.0, phi: 0.01
```

This is ideal for dreamy, light artistic effects where you want the image to feel airy and delicate.

### Charcoal

The charcoal preset produces broad strokes from large spatial support. The large σ discards fine detail and captures only major forms:

```typescript
const xdog = new XDoG(STYLE_PRESETS.charcoal);
// Parameters: sigma: 7.0, k: 1.6, p: 70, epsilon: 0.8, phi: 0.01
```

Use this for bold, expressive results that emphasize major forms over fine detail.

### Woodcut

The woodcut preset uses extreme edge emphasis with aggressive contrast. The very high p value creates dramatic edge exaggeration mimicking the carved appearance of traditional xylography:

```typescript
const xdog = new XDoG(STYLE_PRESETS.woodcut);
// Parameters: sigma: 0.8, k: 1.6, p: 120, epsilon: 0.73, phi: 100
```

This produces high contrast, dramatic illustration suitable for bold graphic work.

---

## Preprocessing: Essential for Photographs

Real-world photographs contain texture—grass, fabric, skin pores—that creates noisy, cluttered output when processed directly. The paper discusses how bilateral preprocessing serves as a "prioritization mechanism" that attenuates weak edges while supporting strong edges. A bilateral filter is essentially a blur operator that removes extraneous detail, but the amount of local blur is guided by image content so that low-contrast regions are blurred more than high-contrast regions. This has the effect of performing a simple indication of mostly homogeneous textures.

**Always preprocess photographs for clean results.** The preprocessing step often matters more than parameter tuning.

### Quick Preprocessing

```typescript
import { 
  XDoG, 
  STYLE_PRESETS,
  imageDataToGrayscale, 
  grayscaleToImageData,
  PreprocessingPresets 
} from 'xdog';

// Convert your image to grayscale
const grayscale = imageDataToGrayscale(canvasImageData);

// Choose preprocessing based on your image type:
const cleaned = PreprocessingPresets.standard(grayscale);  // Most photos
// const cleaned = PreprocessingPresets.nature(grayscale); // Landscapes, grass, foliage
// const cleaned = PreprocessingPresets.heavy(grayscale);  // Very textured images
// const cleaned = PreprocessingPresets.artistic(grayscale); // Painterly look

// Then process
const xdog = new XDoG(STYLE_PRESETS.threshold);
const result = await xdog.process(cleaned);
```

### Preprocessing Presets Explained

The choice of preprocessing depends heavily on your source material. Each preset represents a different balance between detail preservation and noise suppression:

**Light** preprocessing applies minimal bilateral smoothing and is appropriate for clean studio photos, illustrations, and images that have already been processed or are naturally clean. It preserves fine detail while removing only obvious noise artifacts.

**Standard** preprocessing provides balanced smoothing suitable for most outdoor photos and portraits. It removes typical photographic noise and minor texture while preserving important structural edges. This is the recommended starting point for general photography.

**Heavy** preprocessing applies multiple bilateral passes for aggressive texture removal. This is necessary for very textured images like fabric, foliage-heavy backgrounds, grass, or rough surfaces. When the background contains repetitive detail that would otherwise dominate the output, heavy preprocessing ensures that only the important edges remain.

**Nature** preprocessing is specifically tuned for natural textures like grass, leaves, sand, and foliage. These subjects contain structure at multiple scales that can overwhelm edge detection, and the nature preset uses parameters calibrated to suppress this natural texture while preserving larger forms like trees, rocks, and horizon lines.

**Artistic** preprocessing combines Kuwahara filtering for flat, posterized regions with bilateral smoothing. The Kuwahara filter divides each pixel's neighborhood into quadrants, finds the one with lowest variance, and uses its mean. This creates painterly flat regions with preserved edges—a good foundation for more abstract, stylized output.

### Custom Preprocessing Pipeline

For fine control over preprocessing, you can chain multiple operations. The key insight is that the bilateral filter works by averaging pixels based on both spatial proximity (how close they are) and intensity similarity (how similar their brightness values are). This dual weighting is what allows it to smooth texture while preserving edges:

```typescript
import { Preprocessor, bilateralFilter, medianFilter } from 'xdog';

// Method 1: Using the Preprocessor class for chaining operations
const preprocessor = new Preprocessor()
  .bilateral({ sigmaSpatial: 6, sigmaRange: 0.15 })  // Broad smoothing pass
  .bilateral({ sigmaSpatial: 3, sigmaRange: 0.08 })  // Refinement pass
  .contrast(0.01, 0.99);  // Histogram stretching

const cleaned = preprocessor.apply(grayscale);

// Method 2: Calling filter functions directly for maximum control
let cleaned = bilateralFilter(grayscale, { sigmaSpatial: 5, sigmaRange: 0.12 });
cleaned = bilateralFilter(cleaned, { sigmaSpatial: 3, sigmaRange: 0.08 });
```

### Bilateral Filter Parameters

The bilateral filter is the most important preprocessing tool because it smooths texture while preserving edges. Understanding its two main parameters helps you tune it effectively:

**sigmaSpatial** (range 2–10) controls the size of the smoothing neighborhood—how far away pixels are considered when computing the average. Higher values mean more smoothing across larger areas, which can eliminate texture but may blur fine edge detail. Start around 4 and increase if texture remains visible.

**sigmaRange** (range 0.05–0.2) controls sensitivity to intensity differences. This determines how different two pixels need to be before they're considered to belong to different regions. Lower values preserve more edges because even small intensity differences prevent smoothing across them. Higher values allow smoothing across edges too, which can create a more painterly effect but loses edge definition.

The key insight is that **multiple light passes often work better than one aggressive pass**. A single bilateral filter with very high sigmaSpatial might blur edges you want to keep. Instead, running two or three passes with moderate parameters progressively smooths texture while giving each pass the opportunity to respect edge boundaries.

### Other Preprocessing Filters

Beyond bilateral filtering, several other operations can help prepare images:

```typescript
import { 
  medianFilter,      // Removes salt-and-pepper noise (isolated bright/dark pixels)
  kuwaharaFilter,    // Creates painterly flat regions for stylized output
  gaussianBlur,      // Simple smoothing (less edge-preserving than bilateral)
  enhanceContrast,   // Makes edges more distinct by stretching histogram
  quantize           // Reduces intensity levels for posterization effects
} from 'xdog';

// Examples of direct usage:
const denoised = medianFilter(grayscale, { radius: 2 });
const painterly = kuwaharaFilter(grayscale, { radius: 4 });
const enhanced = enhanceContrast(grayscale, 0.01, 0.99);
const posterized = quantize(grayscale, 8);
```

The **median filter** replaces each pixel with the median of its neighborhood, which is excellent for removing isolated noise points (salt-and-pepper noise) without the blurring that Gaussian smoothing introduces.

The **Kuwahara filter** creates a painterly effect by selecting the lowest-variance region around each pixel. This produces flat, posterized areas bounded by sharp transitions—useful when you want an abstract, illustrated look rather than photographic detail.

---

## Parameter Deep Dive

Understanding what each parameter does and how they interact allows you to predictably navigate the style space.

### σ (Sigma): Edge Scale

**Range: 0.3–8.0 | Default: 1.0**

The σ parameter controls the scale of detected edges by setting the standard deviation of the base Gaussian blur. Since small image details are represented by high spatial frequencies, filtering out such details with larger σ values leads to a type of shape abstraction. Intuitively, the more blurred two pictures of different faces are, the more similar they look—and this same principle governs how σ affects edge detection.

With small σ values (0.3–0.5), the filter captures fine details and texture. This is appropriate for images with important small-scale features, but noise and minor texture will also appear as edges. The pencil shading preset uses σ=0.4 specifically because this fine scale mimics the way graphite captures surface texture.

With medium σ values (0.8–1.5), the filter balances detail capture with noise rejection. This range works well for most general-purpose stylization.

With large σ values (2.0–8.0), only major edges survive and the result looks like shape abstraction. The charcoal preset uses σ=7.0 to create the broad, expressive strokes associated with that medium. At very large σ, specific details like eyes and clothing features disappear, leaving only the overall humanoid shape.

**Tuning tip:** Start at σ=1.0–1.4. If the result is too noisy or cluttered, increase σ. If important details are missing, decrease σ.

### k: Blur Ratio

**Range: 1.1–3.0 | Default: 1.6**

The k parameter sets the ratio between the two Gaussian blur sizes. Marr and Hildreth, in their seminal work on edge detection, recommended k=1.6 as a good engineering trade-off between accurate approximation of the Laplacian of Gaussian and adequate sensitivity to edges. The DoG with this ratio effectively functions as a band-pass filter that extracts image features falling within a characteristic frequency band—features that tend to correspond to edge lines.

Lower k values (1.1–1.4) produce thinner lines and capture more detail, because the two Gaussians are closer in size and their difference responds only to higher frequencies.

Higher k values (2.0–3.0) produce thicker, bolder strokes because the difference between the two blur scales is larger.

**Tuning tip:** Keep k at 1.6 unless you specifically want thicker or thinner lines. This value has theoretical backing and works well across a wide range of images.

### p: Sharpening Strength

**Range: 0–150+ | Default: 20**

The p parameter controls the strength of edge emphasis in the reparameterized XDoG formulation. The sharpened image is computed as:

S_σ,k,p(x) = (1 + p) · G_σ(x) - p · G_kσ(x)

This can be understood as unsharp masking of the blurred image, where the brightness has been increased to compensate for any darkening due to the mask. The p parameter directly controls how much the edge information contributes relative to the base blur.

At p=0, there is no edge enhancement—the filter produces just a blurred image. This can be used for pure tone mapping effects.

At p=10–30, edges are normally emphasized. This is suitable for most stylization and produces clearly visible edge lines without extreme exaggeration.

At p=50–100, edge emphasis is strong. Lines become bolder and more prominent.

At p=100+, edge emphasis is extreme. The woodcut preset uses p=120 to create the dramatic, carved appearance of that medium. At these values, both black edges (in light areas) and white edges (in dark areas) become very pronounced.

**Tuning tip:** Start at p=20, which provides strong edges suitable for most styles. Increase for more dramatic, graphic results; decrease for subtler edge enhancement.

### ε (Epsilon): Threshold

**Range: 0–1 | Default: 0.5**

The ε parameter defines the cutoff point between white and black regions. Values above ε become white; values below follow the soft threshold function. The threshold effectively controls the overall "darkness" of the result.

Lower ε values (0.3–0.5) result in more black areas and more visible lines, because fewer pixels exceed the threshold.

Higher ε values (0.7–1.0) result in more white areas and cleaner images with fewer lines, because more pixels exceed the threshold.

The interaction with p is important: increasing p pushes more pixel values toward extremes (either very bright or very dark), which changes how ε divides the image. After adjusting p, you may need to retune ε to maintain the desired black/white balance.

**Tuning tip:** Adjust ε to control overall darkness. For thresholding styles, values around 0.7–0.8 typically produce pleasing results with distinct lines but not overwhelming darkness.

### φ (Phi): Threshold Sharpness

**Range: 0.01–200 | Default: 10**

The φ parameter controls the steepness of the soft threshold function's tanh transition. This is what distinguishes soft pencil shading from hard black-and-white thresholding—both use the same underlying DoG response, but apply different threshold functions to it.

Very low φ values (≈0.01) produce very soft, gradient transitions. The tanh function becomes nearly linear around ε, allowing values below the threshold to span a wide range of gray tones rather than snapping to black. This creates the gradual tonal buildup seen in pencil shading and pastel effects.

Medium φ values (1–20) produce moderate transitions with some gray tones but clearer edge definition than very low values.

High φ values (100–200) produce hard, crisp black/white transitions. As φ increases, the tanh function approaches a step function, eliminating intermediate gray tones. This creates the stark two-tone appearance of ink drawings, woodcuts, and comic art.

**Tuning tip:** For soft, artistic effects (pencil, pastel, charcoal), use φ≈0.01. For hard black/white (threshold, woodcut), use φ=100+. The transition between these regimes is quite sharp—there's a meaningful difference between φ=1 and φ=10, but less difference between φ=100 and φ=200.

---

## FDoG-Specific Parameters

The Flow-based DoG extends the basic algorithm by adapting the filter according to approximated edge orientations. For images with stochastic noise or textures, isotropic formulations may result in excessive small, disconnected edges. The FDoG addresses this by first responding to luminance changes across edges, then smoothing those responses using an edge-aligned blur.

### σc (SigmaC): Structure Tensor Smoothing

**Range: 0.1–8.0 | Default: 2.5**

The σc parameter controls the width of the Gaussian used to blur the structure tensor when computing the Edge Tangent Flow field. The structure tensor is built from image gradients, and smoothing it determines how local or global the edge direction estimates are.

Small σc values (0.1–1.0) capture fine edge directions and can track rapidly changing contours, but the flow field may be noisy if the image contains texture or noise. The pastel FDoG preset uses σc=0.1 specifically to create turbulence in the flow, producing a textured, brush-stroke-like appearance.

Medium σc values (2.0–3.0) provide balanced flow smoothness. The standard FDoG preset uses σc≈2.28, which produces clean, coherent flow for most images.

Large σc values (4.0–8.0) create very smooth flow fields that follow major image structures while ignoring fine details. This can distort fine features but produces very long, smooth edge lines. The woodcut preset uses σc≈5.84 for dramatically smooth flow.

### σm (SigmaM): Flow-Aligned Smoothing

**Range: 0–25 | Default: 4.0**

The σm parameter controls the width of the edge tangent-aligned line integral convolution that smooths the DoG response along edges. This is what makes FDoG lines look "hand-drawn"—the smoothing along the edge direction connects potentially disconnected edge segments into continuous lines.

At σm=0, no flow smoothing is applied and edges may appear disconnected or fragmented.

At low σm values (1–3), edges are short and may still show discontinuities.

At medium σm values (4–8), good line coherence is achieved. Short edge segments are combined into longer, continuous lines.

At high σm values (10–25), lines become very long and smooth. However, if σm is significantly larger than σc, noise may be introduced into the edge lines as the smoothing follows potentially noisy flow directions over long distances.

**Tuning tip:** σm should generally be comparable to or larger than σc for coherent results. The standard preset uses σc≈2.28 with σm≈4.4—roughly double—for good coherence without artifacts.

### σa (SigmaA): Anti-Aliasing

**Range: 0–10 | Default: 1.0**

The σa parameter controls an optional post-processing line integral convolution along the ETF for anti-aliasing. This is particularly important for thresholded images, whose near step-function response can produce harsh pixel boundaries.

At σa=0, anti-aliasing is disabled.

At σa=0.5–2.0, typical anti-aliasing smooths pixel-level artifacts while preserving edge sharpness.

At σa>2, the smoothing becomes stylistic rather than corrective. The pastel preset uses σa=7.2 for a soft, blurred-edge effect.

### FDoG Presets

```typescript
import { FDoG, FDOG_STYLE_PRESETS } from 'xdog';

// Standard coherent line drawing
const fdog1 = FDoG.withPreset('standard');
// σc: 2.28, σm: 4.4, σa: 1.0

// Pastel with visible flow turbulence  
const fdog2 = FDoG.withPreset('pastel');
// σc: 0.1, σm: 20, σa: 7.2

// Woodcut with aggressive flow distortion
const fdog3 = FDoG.withPreset('woodcut');
// σc: 5.84, σm: 3.2, σa: 0.75
```

---

## Troubleshooting

### Problem: Too Much Noise or Texture

When the result shows excessive small edges, scattered marks, or texture that wasn't in the original image, the filter is responding to detail that should be suppressed.

**Solutions:**

1. Apply preprocessing before XDoG processing. Start with `PreprocessingPresets.standard()` and move to `heavy()` or `nature()` if needed. The bilateral filter's edge-preserving smoothing is specifically designed to suppress texture while maintaining important edges.

2. Increase σ to 1.2–2.0. Larger edge scale means fine texture falls below the detection threshold.

3. Increase ε to 0.6–0.8. Raising the white threshold eliminates weaker edge responses.

4. Increase φ to 100–200. Sharper threshold transitions eliminate intermediate gray values that might appear as noise.

### Problem: Lines Too Faint or Thin

When edges are present but difficult to see, the filter is either not emphasizing them enough or the threshold is pushing too much toward white.

**Solutions:**

1. Decrease ε to 0.3–0.5. More of the image will fall below the white threshold, making lines more visible.

2. Increase k to 1.8–2.0. The larger ratio between blur scales produces thicker lines.

3. Increase p to 30–50. Stronger edge emphasis makes lines more prominent relative to the background.

### Problem: Lost Fine Details

When important small-scale features (eyes, fine textures, thin lines) disappear, the filter is operating at too coarse a scale.

**Solutions:**

1. Use lighter preprocessing or skip preprocessing entirely for clean source images.

2. Decrease σ to 0.3–0.5. Smaller edge scale captures finer detail.

3. Decrease k to 1.3–1.5. The narrower band-pass lets more fine detail through.

4. Decrease φ to 10–30. Softer thresholding preserves subtle edge variations.

### Problem: Result Looks Muddy or Gray

When the image lacks contrast and appears flat or washed out, the threshold function isn't creating enough separation between light and dark regions.

**Solutions:**

1. Increase φ to 100+. Hard thresholding creates clear black/white separation.

2. Adjust ε toward 0.5–0.7. The threshold point should fall where it creates meaningful separation in your image's intensity distribution.

3. Apply contrast enhancement in preprocessing. The `enhanceContrast()` function stretches the histogram to use the full 0–1 range before DoG processing.

### Problem: FDoG Lines Look Disconnected

When using FDoG but lines still appear fragmented, the flow-aligned smoothing isn't connecting edge segments effectively.

**Solutions:**

1. Increase σm to 6–10. Longer flow smoothing kernels connect more distant edge segments.

2. Increase σc to 3–4. Smoother flow fields provide more consistent direction information for the line integral convolution.

3. Ensure preprocessing isn't too aggressive. Very heavy smoothing can fragment edges into isolated points that even FDoG cannot connect.

---

## XDoG vs FDoG: When to Use Which

The two algorithms serve different needs and have different computational characteristics:

| Aspect | XDoG | FDoG |
|--------|------|------|
| **Speed** | Fast—suitable for real-time applications | 3–5× slower due to ETF computation and flow-aligned convolution |
| **Blur Type** | Isotropic (uniform in all directions) | Anisotropic (along edge tangent direction) |
| **Line Quality** | Good, but may show discontinuities on noisy input | Smooth, coherent lines that follow edge contours |
| **Best For** | General use, quick results, geometric subjects | Portraits, organic subjects, when line continuity matters |
| **Parameters** | 5 core parameters | 5 core parameters plus 3 flow-specific parameters |

**Use FDoG when:**

- Processing portraits where you want smooth, flowing lines that follow facial contours
- Working with organic subjects like plants, animals, or fabric where edges should flow naturally
- Line continuity is important to the aesthetic you're seeking
- You want that distinctive "hand-drawn illustration" quality with long, confident strokes

**Use XDoG when:**

- Real-time performance is required (video, interactive applications)
- Processing architecture and geometric subjects where straight edges are appropriate
- Speed matters more than perfect line coherence
- Creating quick previews before committing to slower FDoG processing

---

## Example Workflows

### Portrait Line Drawing

Portraits benefit from FDoG's flow-aligned processing because facial features have natural contours that the ETF can follow. Standard preprocessing removes skin texture while preserving feature edges:

```typescript
import { FDoG, FDOG_STYLE_PRESETS, PreprocessingPresets, imageDataToGrayscale, grayscaleToImageData } from 'xdog';

const grayscale = imageDataToGrayscale(imageData);
const cleaned = PreprocessingPresets.standard(grayscale);

const fdog = FDoG.withPreset('standard');
const result = await fdog.process(cleaned);

const output = grayscaleToImageData(result);
ctx.putImageData(output, 0, 0);
```

### Landscape with Heavy Texture

Landscapes containing grass, foliage, or beach scenes require aggressive preprocessing to suppress natural texture. The nature preset is specifically calibrated for these subjects:

```typescript
import { XDoG, STYLE_PRESETS, PreprocessingPresets, imageDataToGrayscale, grayscaleToImageData } from 'xdog';

const grayscale = imageDataToGrayscale(imageData);
const cleaned = PreprocessingPresets.nature(grayscale);

const xdog = new XDoG({
  ...STYLE_PRESETS.threshold,
  sigma: 1.2,    // Slightly higher to skip any remaining texture
  epsilon: 0.65  // Slightly higher for cleaner result
});

const result = await xdog.process(cleaned);
```

### Soft Pencil Sketch

The pencil shading effect relies on capturing fine texture and allowing gradual tonal transitions. Light preprocessing preserves the detail that creates the graphite-like appearance:

```typescript
import { XDoG, STYLE_PRESETS, PreprocessingPresets, imageDataToGrayscale, grayscaleToImageData } from 'xdog';

const grayscale = imageDataToGrayscale(imageData);
const cleaned = PreprocessingPresets.light(grayscale);

const xdog = new XDoG(STYLE_PRESETS.pencilShading);
const result = await xdog.process(cleaned);
```

### High-Contrast Manga Style

Manga-style illustration typically features stark black-and-white contrast with crisp edges. Custom preprocessing with a contrast boost helps create the punchy look:

```typescript
import { XDoG, imageDataToGrayscale, grayscaleToImageData, Preprocessor } from 'xdog';

const grayscale = imageDataToGrayscale(imageData);

// Custom preprocessing with contrast boost
const preprocessor = new Preprocessor()
  .bilateral({ sigmaSpatial: 3, sigmaRange: 0.08 })
  .contrast(0.02, 0.98);  // Stretch histogram for punchier blacks

const cleaned = preprocessor.apply(grayscale);

const xdog = new XDoG({
  sigma: 0.6,    // Small for fine detail
  k: 1.8,        // Slightly larger for bolder lines
  p: 40,         // Strong edge emphasis
  epsilon: 0.6,  // Moderate threshold
  phi: 200       // Very high for crisp black/white
});

const result = await xdog.process(cleaned);
```

### Pastel with Color

The colored pastel effect modulates the grayscale XDoG result with the original image colors. The XDoG provides the tonal structure while the source image provides the color:

```typescript
import { XDoG, STYLE_PRESETS, PreprocessingPresets, imageDataToGrayscale } from 'xdog';

const grayscale = imageDataToGrayscale(imageData);
const cleaned = PreprocessingPresets.artistic(grayscale);

const xdog = new XDoG(STYLE_PRESETS.pastel);
const pastelResult = await xdog.process(cleaned);

// Modulate source colors by inverted pastel result
const output = new ImageData(imageData.width, imageData.height);
for (let i = 0; i < pastelResult.data.length; i++) {
  const weight = 1 - pastelResult.data[i];  // Invert: darker pastel = more color
  output.data[i * 4] = imageData.data[i * 4] * (1 - weight * 0.5);
  output.data[i * 4 + 1] = imageData.data[i * 4 + 1] * (1 - weight * 0.5);
  output.data[i * 4 + 2] = imageData.data[i * 4 + 2] * (1 - weight * 0.5);
  output.data[i * 4 + 3] = 255;
}
```