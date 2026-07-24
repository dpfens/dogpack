/**
 * Core types for XDoG/FDoG/ADoG/HDoG line drawing implementation
 * 
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 * and: "Gaussian Image Binarization" by Kang & Stamoulis (2021)
 */

/**
 * Simple 2D vector
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * A lazily-evaluated per-pixel scalar value. Replaces the old
 * `number | ChannelImage` union used for spatially-varying parameters
 * (p, epsilon, phi, ...): a plain number becomes `ScalarField.constant()`,
 * an existing buffer becomes `ScalarField.fromChannelImage()`, and both
 * compose via map()/blend()/scale() without allocating until
 * materialize() forces evaluation into a real ChannelImage. See
 * utils/scalar-field.ts for the constructors and combinators.
 */
export interface ScalarField {
  sample(i: number): number;
}

/**
 * Single-channel image representation
 * Using a flat Float32Array for performance and future GPU compatibility
 * Values are normalized to 0-1 range
 */
export interface ChannelImage {
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * RGB image representation
 */
export interface RGBImage {
  data: Float32Array; // Interleaved RGB, length = width * height * 3
  width: number;
  height: number;
}

export type GradientAlignedBlurBackendConfig = Partial<GradientAlignedBlurConfig> & {
  flowField: FlowField;
};

/**
 * Implemented by anything holding resources that must be explicitly
 * released (e.g. GPU buffers/textures). CPU-only implementations may
 * implement this as a no-op, but still implement it — callers that manage
 * a mixed pipeline of strategies need to be able to dispose everything
 * uniformly without checking which backend each instance happens to use.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Implemented by anything with a technology-specific backing
 * implementation (CPU, WebGL, WebGPU, ...), exposing which one is
 * actually in use.
 *
 * Lets callers/perf tooling tell what ran without guessing — relevant
 * since backend selection can fall back silently after construction (e.g.
 * on a lost WebGL context). Single-backend implementations (e.g. a
 * CPU-only preprocessor with no GPU counterpart) still report it — just
 * always the same value.
 */
export interface BackendIdentifiable {
  readonly backend: 'webgpu' | 'webgl' | 'cpu';
}

/**
 * Abstract blur strategy interface
 * Implementations provide different blur algorithms (isotropic, flow-guided, etc.)
 */
export interface BlurStrategy extends Disposable, BackendIdentifiable {
  /**
   * Apply blur to an image with the given sigma
   * @param input Source image
   * @param sigma Blur radius (standard deviation)
   * @returns Blurred image
   */
  blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}

/**
 * Generic static (constructor) interface shared by every strategy family
 * in this file (blur, preprocessing, ETF, ...).
 *
 * This is deliberately a separate interface from the instance interface
 * (`T`) rather than statics bolted onto it: `implements` only constrains
 * instance shape, not the statics on a class object, so runtime-
 * availability checks have to live on their own constructor-shaped
 * interface and get asserted with `satisfies` instead.
 */
export interface StrategyCtor<T> {
  new (config: any): T;

  /**
   * Check if this backend is supported in the current environment. Async
   * because GPU support checks (requestAdapter(), WebGL context creation)
   * are inherently async.
   * @returns true if the backend can be used, false otherwise
   */
  isSupported(): Promise<boolean>;

  /**
   * Get a human-readable reason if the backend is not supported. May be
   * asynchronous: cheap synchronous API-surface checks can't confirm a GPU
   * adapter is actually obtainable — that requires an async request.
   * @returns undefined if supported, or a string explaining why it's not
   */
  getUnsupportedReason?(): string | undefined | Promise<string | undefined>;
}

/**
 * Static (constructor) interface for blur strategy classes.
 */
export type BlurStrategyCtor = StrategyCtor<BlurStrategy>;


/**
 * Abstract preprocessing strategy interface
 * Implementations provide different image preprocessing/conditioning
 * operations (bilateral filtering, median filtering, Kuwahara filtering,
 * Gaussian blur, contrast enhancement, quantization, etc.) applied to an
 * image before line detection.
 */
export interface Preprocessor extends Disposable, BackendIdentifiable {
  /**
   * Apply this preprocessing operation to an image
   * @param input Source image
   * @returns Processed image
   */
  process(input: ChannelImage): Promise<ChannelImage>;
}

/**
 * Static (constructor) interface for preprocessor classes.
 */
export type PreprocessorCtor = StrategyCtor<Preprocessor>;

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

export const DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG: GradientAlignedBlurConfig = {
  kernelSizeMultiplier: 6,
  stepSize: 1.0,
};


/**
 * Flow field representing edge tangent directions at each pixel, along
 * with the structure-tensor-derived confidence data for that direction.
 *
 * magnitude and anisotropy are first-class here (not a separate
 * "detailed" result) because every consumer of a FlowField benefits from
 * knowing how much to trust it -- not just the callers who happened to
 * ask for the detailed variant. See ETFComputer.compute() for how these
 * are produced.
 */
export interface FlowField {
  getTangent(x: number, y: number): Vec2;

  /**
   * Structure-tensor trace magnitude, sqrt(E + G), at this pixel.
   * Unnormalized -- scale depends on input contrast. Use
   * utils/scalar-field.js's normalizedMagnitudeField() to get a [0,1]
   * field normalized against this FlowField's own maximum.
   */
  getMagnitude(x: number, y: number): number;

  /**
   * (lambda1-lambda2)/(lambda1+lambda2) in [0,1] at this pixel. 1 =
   * coherent line direction, 0 = isotropic (flat region, corner, or
   * texture noise where local gradients disagree).
   */
  getAnisotropy(x: number, y: number): number;

  readonly width: number;
  readonly height: number;
}

export interface BilateralFilterConfig {
  /** Spatial sigma - controls the size of the neighborhood (default: 3) */
  sigmaSpatial: number;
  
  /** Range/intensity sigma - controls sensitivity to intensity differences (default: 0.1) */
  sigmaRange: number;
  
  /** Kernel radius multiplier (default: 2, meaning radius = sigmaSpatial * 2) */
  radiusMultiplier?: number;
}

/**
 * Configuration for median filter
 */
export interface MedianFilterConfig {
  /** Radius of the filter (default: 2, meaning 5x5 kernel) */
  radius: number;
}

/**
 * Configuration for Kuwahara filter
 */
export interface KuwaharaFilterConfig {
  /** Radius of the filter (default: 3) */
  radius: number;
}

/**
 * Configuration for Edge Tangent Flow computation
 * 
 * The ETF is computed from the smoothed structure tensor of image gradients.
 * See Section 2.6 of the paper.
 */
export interface ETFConfig {
  /** 
   * Number of refinement iterations for the tangent field (default: 3)
   * More iterations increase line coherence but add computation time
   */
  iterations: number;
  
  /** 
   * Kernel size for structure tensor smoothing (default: 5)
   * Paper uses Gaussian smoothing with sampling within 2.45 * σc
   */
  kernelSize: number;
}

/**
 * Default ETF configuration values
 */
export const DEFAULT_ETF_CONFIG: ETFConfig = {
  iterations: 3,
  kernelSize: 5,
};


/**
 * Structure tensor components at a pixel
 * The structure tensor is: | E  F |
 *                          | F  G |
 * where E = Ix^2, F = Ix*Iy, G = Iy^2
 */
export interface StructureTensor {
  e: Float32Array; // Ix^2
  f: Float32Array; // Ix * Iy
  g: Float32Array; // Iy^2
}

/**
 * Raw x/y gradient field for a single scalar channel.
 */
export interface Gradients {
  x: Float32Array;
  y: Float32Array;
}

/**
 * A structure tensor plus its derived scalar magnitude field (the
 * tensor's trace: sqrt(E + G)). Both the tensor components and the
 * magnitude are additive across channels (Di Zenzo summation), which is
 * what allows multi-channel ETF to reuse the same downstream pipeline
 * (smoothing -> eigendecomposition -> refinement) as single-channel ETF.
 */
export interface ChannelTensor {
  tensor: StructureTensor;
  magnitude: Float32Array;
}

/**
 * Common interface implemented by every Edge Tangent Flow backend
 * (CPU, WebGL, WebGPU, ...).
 *
 * Multi-channel computation follows Di Zenzo's multichannel structure
 * tensor approach ("A note on the gradient of a multi-image", CVGIP 33,
 * 1986): implementations must combine per-channel structure tensors
 * (not per-channel tangents) before eigendecomposition, so that a single
 * eigendecomposition is performed on the combined tensor.
 *
 * Implementations have no color-space knowledge: a ChannelImage is just
 * an arbitrary scalar field. Any color-space conversion or splitting
 * (e.g. RGB -> Lab, or de-interleaving RGB into R/G/B channels) is the
 * caller's responsibility and happens before compute()/computeMultiChannel()
 * is called.
 */
export interface ETFComputer extends Disposable, BackendIdentifiable {
  /**
   * Compute an Edge Tangent Flow from a single scalar channel.
   *
   * @param input Scalar channel image (values in 0-1)
   * @param config ETF configuration
   * @param sigmaC Structure tensor smoothing sigma (optional override)
   */
  compute(
    input: ChannelImage,
    config?: Partial<ETFConfig>,
    sigmaC?: number
  ): Promise<FlowField>;

  /**
   * Compute an Edge Tangent Flow jointly from several co-registered
   * scalar channels (e.g. R/G/B or L/a/b), using Di Zenzo's multichannel
   * structure tensor. All channels must share the same width/height.
   *
   * @param inputs Channel images, all with the same dimensions
   * @param config ETF configuration
   * @param sigmaC Structure tensor smoothing sigma (optional override)
   */
  computeMultiChannel(
    inputs: ChannelImage[],
    config?: Partial<ETFConfig>,
    sigmaC?: number
  ): Promise<FlowField>;
}

/**
 * Static (constructor) interface for ETFComputer classes.
 */
export type ETFComputerCtor = StrategyCtor<ETFComputer>;


export interface ToneAdaptiveEpsilonOptions {
  /**
   * Epsilon to use where the local area is darkest (local tone -> 0).
   */
  epsilonDark: number;

  /**
   * Epsilon to use where the local area is lightest (local tone -> 1).
   */
  epsilonLight: number;

  /**
   * Gaussian sigma used to blur the input before reading its tone. This is
   * what makes it a *local area* reading rather than a noisy per-pixel one --
   * bigger sigma means tone is averaged over a broader neighborhood. Should
   * generally be larger than the DoG's own sigmaC/sigmaS (which operate at
   * edge scale) so this is describing the surrounding region, not the edge
   * itself.
   * Default: 8
   */
  localitySigma?: number;

  /**
   * Steepness of the tanh transition between epsilonDark and epsilonLight,
   * mirroring the paper's `s` parameter in Eq. (5)/(6) (default there is 2).
   * Higher values sharpen the transition around the midtones; lower values
   * spread it out more gradually across the whole tone range.
   * Default: 2
   */
  s?: number;

  /**
   * Reuse an existing blur strategy (e.g. one already created elsewhere in
   * your pipeline) instead of spinning up a fresh IsotropicBlur. If omitted,
   * one is created and disposed internally.
   */
  blurStrategy?: BlurStrategy;
}


export interface ToneAdaptiveEpsilonAutoOptions
  extends Omit<ToneAdaptiveEpsilonOptions, 'epsilonDark' | 'epsilonLight'> {
  /**
   * Center epsilon to build the dark/light band around -- e.g. the output of
   * `ADoG.estimateEpsilon(input)`, or whatever flat epsilon you're already
   * using today.
   */
  center: number;

  /**
   * Half-width of the [epsilonDark, epsilonLight] band around `center`.
   * Start small (e.g. 5-10% of `center`) and increase until dark/light
   * regions both look right; too large will just push one extreme toward
   * losing all detail.
   */
  spread: number;

  /**
   * If true (default), dark areas get `center - spread` and light areas get
   * `center + spread` -- i.e. epsilon increases with local tone, the same
   * direction the sharpened response itself moves in (see the module-level
   * comment above, grounded in processor.ts's Eq. 7 + soft-threshold logic).
   * Only flip this if you've changed the pipeline in a way that inverts that
   * relationship (e.g. an unusually large `p`, or a custom ThresholdStrategy)
   * and have confirmed the output actually looks better.
   */
  denserInDark?: boolean;
}


export interface LocalBaselineEpsilonOptions {
  /**
   * Blur sigma used to estimate the local baseline. For this to track what
   * `computeSharpening()` actually produces in flat regions, this should be
   * close to the DoG's own `sigma` (blur1's scale) -- not `sigma * k`, and
   * not an unrelated "how big is a neighborhood" value picked independently
   * of the DoG config you're pairing it with.
   */
  sigma: number;

  /**
   * Flat offset applied on top of the local baseline. Positive -> stricter
   * everywhere (more of each neighborhood crushes to black); negative ->
   * looser everywhere (more crushes to white). Start at 0 and nudge from
   * there; plays the same role as `ADoG.estimateEpsilon`'s `biasOffset`.
   * Default: 0
   */
  offset?: number;

  blurStrategy?: BlurStrategy;
}