# DoGPack Line Drawing Library

A TypeScript implementation of Difference-of-Gaussians (DoG) algorithms for artistic line drawing and edge stylization.

## Overview

This library turns photos into line drawings. You give it an image, tweak a few parameters, and get back stylized edges that look hand-drawn rather than computer-generated.

| Original | HDoG |
|----------|-----|
| ![Original](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/dog/original.png) | ![HDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/dog/line-drawing-hdog.png) |

There are four main algorithms:
* XDoG is the fast, line-only option. It applies Gaussian blurs at two different scales, subtracts them to find edges, then applies a soft threshold to create the final look. You can dial it from soft pencil shading to stark black-and-white woodcut with just a few parameter changes. Processing is nearly instant on modern hardware, but like FDoG, it only captures structure; it has no notion of tone or shading.
* FDoG is the quality line-drawing option. It does everything XDoG does, but first computes a "flow field" that tracks the direction of edges throughout the image, then blurs along those edges instead of uniformly in all directions. The result is smoother, more coherent lines (like an illustrator would draw) but it takes 3-5x longer to process. Like XDoG, it only produces lines; no tone or shading.
* ADoG is the screentoning option. It repurposes the same Gaussian subtraction as XDoG/FDoG, but makes it sensitive to local brightness, so darker regions get denser tone and lighter regions stay sparse. The output is dot-like primitives approximating shading, similar to stippling but without a complex placement algorithm.
* HDoG is the hybrid option. It combines FDoG's line extraction with ADoG's screentoning into one output, giving you structure and shading together where either alone falls short. It costs more than a single pass, but stays linear-time and GPU-friendly like the others.

Both XDog and FDoG algorithms share the same parameter space for controlling line thickness, contrast, and threshold sharpness. The only difference is whether the blur respects edge direction.

| Subject   | Original | XDoG | FDoG | ADoG | HDoG | XDoG + FDoG Multi-Scale |
|-----------|----------|------|------|------|------|-------------------------|
| Chelsea   | ![Original](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/chelsea/original.png) | ![XDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/chelsea/line-drawing-xdog.png) | ![FDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/chelsea/line-drawing-fdog.png) | ![ADoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/chelsea/line-drawing-adog.png) | ![HDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/chelsea/line-drawing-hdog.png) | ![XDoG Multi-Scale](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/chelsea/xdog-multiScale.png) |
| House     | ![Original](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/house/original.png) | ![XDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/house/line-drawing-xdog.png) | ![FDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/house/line-drawing-fdog.png) | ![ADoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/house/line-drawing-adog.png) | ![HDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/house/line-drawing-hdog.png) | ![XDoG Multi-Scale](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/house/xdog-multiScale.png) |
| Landscape | ![Original](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/landscape/original.png) | ![XDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/landscape/line-drawing-xdog.png) | ![FDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/landscape/line-drawing-fdog.png) | ![ADoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/landscape/line-drawing-adog.png) | ![HDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/landscape/line-drawing-hdog.png) | ![XDoG Multi-Scale](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/landscape/xdog-multiScale.png) |
| Mandrill  | ![Original](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/mandrill/original.png) | ![XDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/mandrill/line-drawing-xdog.png) | ![FDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/mandrill/line-drawing-fdog.png) | ![ADoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/mandrill/line-drawing-adog.png) | ![HDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/mandrill/line-drawing-hdog.png) | ![XDoG Multi-Scale](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/mandrill/xdog-multiScale.png) |
| Peppers   | ![Original](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/peppers/original.png) | ![XDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/peppers/line-drawing-xdog.png) | ![FDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/peppers/line-drawing-fdog.png) | ![ADoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/peppers/line-drawing-adog.png) | ![HDoG](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/peppers/line-drawing-hdog.png) | ![XDoG Multi-Scale](https://github.com/dpfens/dogpack/raw/refs/heads/main/images/peppers/xdog-multiScale.png) |

## Installation

```bash
npm install dogpack
```

## Quick Start

### Basic XDoG

The simplest way to process an image is to create an XDoG instance and pass it canvas `ImageData`. The filter handles grayscale conversion internally:

```typescript
import { dog } from 'dogpack';

// Create processor with default settings
const xdog = new dog.XDoG();

// Process canvas ImageData
const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

const result = await xdog.processChannelImageData(imageData);
xdog.dispose();
ctx.putImageData(result, 0, 0);
```

### Using Style Presets

The library includes several presets based on the parameter ranges documented in the original paper. These presets correspond to specific artistic styles demonstrated in the research:

```typescript
import { dog } from 'dogpack';

// Use a preset directly
const xdog = new dog.XDoG(STYLE_PRESETS.pencilShading);

// Or use the factory method for cleaner code
const xdog2 = XDoG.withPreset('threshold');
const xdog3 = XDoG.withPreset('woodcut');
```

### FDoG for Coherent Lines

When working with images containing noise or fine textures, the FDoG produces substantially cleaner results by aligning the blur operations with the local edge structure. The technique computes an Edge Tangent Flow (ETF) from the smoothed structure tensor of image gradients, then uses this flow field to guide both the DoG computation and subsequent smoothing:

```typescript
import { dog } from 'dogpack';

// Configure FDoG with flow-specific parameters
const fdog = new dog.FDoG({
  sigma: 1.4,      // Edge detection sigma (σe) - controls edge width
  sigmaC: 2.5,     // Structure tensor smoothing (σc) - controls ETF smoothness
  sigmaM: 4.0,     // Flow-aligned smoothing (σm) - controls line coherence
  sigmaA: 1.0,     // Anti-aliasing LIC sigma (σa)
  p: 20,           // Sharpening strength
  phi: 10,         // Threshold sharpness
});

const result = await fdog.processChannelImageData(imageData);
fdog.dispose();

// Or use a preset tuned for specific effects
const fdog2 = FDoG.withPreset('standard');
```

### Custom Configuration

Each parameter in the XDoG filter serves a specific purpose, and understanding their relationships allows for precise control over the output. The reparameterization used in this implementation (using `p` instead of `tau `) decouples edge sharpening strength from threshold parameters, making the filter much easier to control:

```typescript
import { dog } from 'dogpack';

const xdog = new dog.XDoG({
  sigma: 1.4,      // Base blur size - controls scale of detected edges
  k: 1.6,          // Ratio between blur sizes (1.6 recommended as engineering trade-off)
  p: 20,           // Sharpening strength (replaces old tau  parameter)
  epsilon: 0.78,   // Threshold point - values above become white
  phi: 100,        // Threshold sharpness - controls transition steepness
});

// Parameters can be overridden per-call without modifying the instance
const result = await xdog.process(grayscaleImage, { phi: 5 });
xdog.dispose();
```

## Configuration Parameters

### Understanding the DoG Operator

The DoG operator approximates the scale-normalized Laplacian of Gaussian and functions as a band-pass filter, extracting image features falling within a characteristic frequency band that corresponds to edge lines. The subtraction of two Gaussians with different `sigma` creates this band-pass behavior, attenuating frequencies outside the range between the two cutoff frequencies.

From a neurobiological perspective, this center-surround mechanism mirrors how certain retinal cells behave, where stimulation of a central cell is inhibited by simultaneous excitation of its surrounding neighbors. This biological inspiration informed the original DoG formulation and helps explain why DoG-filtered images appear natural and visually appealing.

### Core DoG Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `sigma` | 1.0 | 0.3–8.0 | The base Gaussian blur `sigma` that controls the scale of detected edges. Smaller values capture fine details but may amplify noise, while larger values detect only coarse edges and produce broader strokes. The paper typically uses values between 0.4 and 2.0 for most styles. |
| `k` | 1.6 | 1.1–3.0 | The ratio between the two Gaussian blur sizes. Marr and Hildreth recommended k = 1.6 as a good engineering trade-off between accurate approximation of the Laplacian and adequate sensitivity. This value approximates the Laplacian of Gaussian effectively. |
| `p` | 20.0 | 0–150+ | The sharpening strength parameter from the reparameterized formulation. At p ≈ 0, the filter produces no edge enhancement (just a blurred image). At p ≈ 20, edges are strongly emphasized and suitable for most stylization. Values of 100+ create extreme emphasis for woodcut-style effects. |
| `epsilon` | 0.5 | 0–1 | The threshold value controlling the transition between white and black regions. Values above ε become white, while values below follow the soft threshold function. For normalized images, this should typically be in the 0.5–0.8 range. |
| `phi` | 10.0 | 0.01–200 | Controls the steepness of the tanh soft threshold function. Very low values (≈ 0.01) produce soft, gradual transitions suitable for pencil shading and pastel effects. High values (100+) approach a step function, producing hard black/white edges suitable for thresholding and woodcut styles. |


## Style Presets


### XDoG Presets (`STYLE_PRESETS`)

These presets are derived from the parameter settings documented in Appendix A of the paper and correspond to specific figures and style demonstrations:

| Preset | Description | Key Settings |
|--------|-------------|--------------|
| `pencilShading` | High-frequency detail resembling graphite on paper. The small `sigma` captures fine texture, and the very low `phi` ensures soft, gradual tonal transitions that mimic the way graphite builds up on paper. | sigma=0.4, p=20, phi=0.01 |
| `pastel` | Intermediate edge width with mostly white regions. The higher ε threshold pushes most values to white, while the low `phi` maintains soft color transitions. | sigma=2.0, p=40, phi=0.01 |
| `charcoal` | Broad strokes from large spatial support. The large `sigma` discards fine detail and captures only major forms, creating the bold, expressive quality associated with charcoal drawing. | sigma=7.0, p=70, phi=0.01 |
| `threshold` | Clean black and white line art. The high `phi` creates a near step-function threshold, producing the stark two-tone images suitable for comics and technical illustration. | sigma=1.4, p=20, phi=100 |
| `woodcut` | Extreme edge emphasis with aggressive contrast. The very high p value creates dramatic edge exaggeration, mimicking the carved appearance of traditional xylography. | sigma=0.8, p=120, phi=100 |

### FDoG Presets (`FDOG_STYLE_PRESETS`)

These presets combine the core DoG parameters with flow-specific settings for different artistic effects:

| Preset | Description | Key Settings |
|--------|-------------|--------------|
| `standard` | Coherent line drawing with smooth, connected edges. The balanced `sigmaC`  and `sigmaM`  values produce clean flow-aligned results suitable for most portrait and figure work. | sigmaC=2.28, sigmaM=4.4, sigmaA=1.0 |
| `pastel` | Flow-aligned smoothing with noticeable turbulence. The minimal structure tensor smoothing combined with large flow smoothing creates visible brush-stroke-like texture along edges. | sigmaC=0.1, sigmaM=20, sigmaA=7.2 |
| `woodcut` | Aggressive flow distortion for dramatic carved effects. The larger `sigmaC`  creates very smooth flow fields, while the moderate `sigmaM`  maintains some edge definition. | sigmaC=5.84, sigmaM=3.2, sigmaA=0.75 |


## ADoG for Screentone Shading

Beyond XDoG/FDoG's line-only output, ADoG adds tone: it produces a halftone-like screentone pattern whose density responds to local brightness (darker regions get denser dots, lighter regions stay clean) — think manga/comic-style shading rather than a line drawing.

```typescript
import { dog } from 'dogpack';

const adog = new dog.ADoG();
const result = await adog.process(grayscaleImage);
adog.dispose();

// Or use the bundled preset
const adog2 = new dog.ADoG(dog.ADOG_STYLE_PRESETS.standard);

// Or the one-shot convenience function
const result2 = await dog.adog(grayscaleImage);
```

See [ADVANCED.md](./ADVANCED.md#adog-adaptive-difference-of-gaussians) for how it works and its tunable parameters (`tau`, `s`, `noiseScaleC`, etc).

## HDoG for Lines + Shading Together

HDoG combines FDoG's coherent linework with ADoG's screentoning in one pass, so you get inked lines *and* halftone shading together rather than choosing one or the other:

```typescript
import { dog } from 'dogpack';

const hdog = new dog.HDoG();
const result = await hdog.process(grayscaleImage);
hdog.dispose();

// Or the one-shot convenience function
const result2 = await dog.hdog(grayscaleImage);
```

It's the most computationally expensive processor in the library, since it runs FDoG plus two ADoG passes under the hood. See [ADVANCED.md](./ADVANCED.md#hdog-hybrid-difference-of-gaussians) for the nested config (`fdog`, `adog`, `adogSecondaryScaleFactor`), per-pass outputs via `processDetailed`, and how it works.

## A Note on GPU Resources

`XDoG`, `ADoG`, and `HDoG` instances hold GPU-backed resources (WebGL/WebGPU) that aren't garbage collected. Always call `.dispose()` when you're done with an instance:

```typescript
const xdog = new dog.XDoG();
try {
  const result = await xdog.process(grayscaleImage);
} finally {
  xdog.dispose();
}
```

The one-shot convenience functions (`xdog()`, `fdog()`, `adog()`, `hdog()`) call `dispose()` internally already. See [ADVANCED.md](./ADVANCED.md#performance-considerations) for caching/reuse strategies and per-class disposal details.

## Advanced Usage

For pluggable threshold strategies, spatially-varying parameters, color-aware stylization, preprocessing pipelines, architecture/extensibility, ADoG, HDoG, and performance tuning, see **[ADVANCED.md](./ADVANCED.md)**.


- Winnemöller, H., Kyprianidis, J. E., & Olsen, S. C. (2012). "XDoG: An eXtended difference-of-Gaussians compendium including advanced image stylization." Computers & Graphics, Vol. 36, Issue 6, pp. 720–753.
- Kang, H., Lee, S., & Chui, C. K. (2007). "Coherent line drawing." Proceedings of NPAR '07, pp. 43–50.
- Kang, H., & Stamoulis, I. (2021). "Gaussian Image Binarization." International Journal of Image and Graphics, Vol. 21, No. 4, 2150047.
- Kyprianidis, J. E., & Döllner, J. (2008). "Image abstraction by structure adaptive filtering." Proc. EG UK Theory and Practice of Computer Graphics, pp. 51–58.
- Marr, D., & Hildreth, E. C. (1980). "Theory of edge detection." Proc. Royal Society of London, Biological Sciences, Vol. 207, pp. 187–217.

## License

Apache 2.0