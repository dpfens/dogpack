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
interface Vec2 {
    x: number;
    y: number;
}
/**
 * Single-channel image representation
 * Using a flat Float32Array for performance and future GPU compatibility
 * Values are normalized to 0-1 range
 */
interface ChannelImage {
    data: Float32Array;
    width: number;
    height: number;
}
/**
 * RGB image representation
 */
interface RGBImage$1 {
    data: Float32Array;
    width: number;
    height: number;
}
/**
 * Implemented by anything holding resources that must be explicitly
 * released (e.g. GPU buffers/textures). CPU-only implementations may
 * implement this as a no-op, but still implement it — callers that manage
 * a mixed pipeline of strategies need to be able to dispose everything
 * uniformly without checking which backend each instance happens to use.
 */
interface Disposable {
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
interface BackendIdentifiable {
    readonly backend: 'webgpu' | 'webgl' | 'cpu';
}
/**
 * Abstract blur strategy interface
 * Implementations provide different blur algorithms (isotropic, flow-guided, etc.)
 */
interface BlurStrategy extends Disposable, BackendIdentifiable {
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
interface StrategyCtor<T> {
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
 * Abstract preprocessing strategy interface
 * Implementations provide different image preprocessing/conditioning
 * operations (bilateral filtering, median filtering, Kuwahara filtering,
 * Gaussian blur, contrast enhancement, quantization, etc.) applied to an
 * image before line detection.
 */
interface Preprocessor extends Disposable, BackendIdentifiable {
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
type PreprocessorCtor = StrategyCtor<Preprocessor>;
/**
 * Configuration for flow-guided blur
 */
interface GradientAlignedBlurConfig {
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
/**
 * Flow field representing edge tangent directions at each pixel
 */
interface FlowField {
    getTangent(x: number, y: number): Vec2;
    readonly width: number;
    readonly height: number;
}
interface BilateralFilterConfig {
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
interface MedianFilterConfig {
    /** Radius of the filter (default: 2, meaning 5x5 kernel) */
    radius: number;
}
/**
 * Configuration for Kuwahara filter
 */
interface KuwaharaFilterConfig {
    /** Radius of the filter (default: 3) */
    radius: number;
}
/**
 * Configuration for Edge Tangent Flow computation
 *
 * The ETF is computed from the smoothed structure tensor of image gradients.
 * See Section 2.6 of the paper.
 */
interface ETFConfig {
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
declare const DEFAULT_ETF_CONFIG: ETFConfig;
/**
 * Result of a *Detailed ETF computation: the flow field plus its
 * underlying magnitude field (the structure tensor's trace), exposed as
 * an ordinary ChannelImage so it composes with the rest of the library's
 * scalar-field tooling — e.g. as a stroke-opacity or seed-density map via
 * the same adaptiveMap() pattern used for spatially-varying p/epsilon.
 */
interface ETFDetailedResult {
    flowField: FlowField;
    magnitude: ChannelImage;
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
interface ETFComputer extends Disposable, BackendIdentifiable {
    /**
     * Compute an Edge Tangent Flow from a single scalar channel.
     *
     * @param input Scalar channel image (values in 0-1)
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma (optional override)
     */
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    /**
     * Compute an Edge Tangent Flow jointly from several co-registered
     * scalar channels (e.g. R/G/B or L/a/b), using Di Zenzo's multichannel
     * structure tensor. All channels must share the same width/height.
     *
     * @param inputs Channel images, all with the same dimensions
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma (optional override)
     */
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    /** Same as compute(), but also returns the per-pixel structure-tensor
     *  magnitude instead of discarding it. */
    computeDetailed(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<ETFDetailedResult>;
    computeMultiChannelDetailed(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<ETFDetailedResult>;
}

interface ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
interface ThresholdConfig {
    epsilon: number | ChannelImage;
    phi: number | ChannelImage;
}
declare class SoftThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
/**
 * Hard black/white threshold (step function).
 * Equivalent to φ → ∞ in SoftThresholdStrategy, and to ThresholdModes.hard
 * in processor.ts, but expressed as a ThresholdStrategy so it can be plugged
 * into DoGConfig.thresholdStrategy (e.g. as ADoG's default, since the paper's
 * screentone output is binarized rather than soft-thresholded).
 */
declare class HardThresholdStrategy implements ThresholdStrategy {
    threshold(input: ChannelImage, config: ThresholdConfig): ChannelImage;
}
/**
 * Canny-style double-threshold strategy with hysteresis edge linking.
 *
 * Classifies each pixel against a high and low bound derived from `epsilon`
 * (`epsilon + highOffset` and `epsilon - highOffset`... see note below) into
 * strong edge, weak edge, and background tiers then promotes weak
 * edges to strong ones if they are 8-connected to a strong edge via flood fill.
 * This suppresses isolated noise pixels while preserving continuous edge lines
 * that dip briefly below the main threshold, which a single global threshold
 * (e.g. HardThresholdStrategy) cannot do.
 *
 * Note: `phi` from ThresholdConfig is unused by this strategy. Sharpness of
 * the strong/weak/background split is controlled entirely by `highOffset` and
 * `lowOffset`, not by a tanh steepness parameter.
 */
declare class HysteresisThresholdStrategy implements ThresholdStrategy {
    private readonly highOffset;
    private readonly lowOffset;
    /**
     * @param highOffset - Amount added to `epsilon` to form the high (strong-edge)
     *   bound (default: 0.2). Pixels at or above `epsilon + highOffset` are
     *   immediately classified as strong edges (seeds for flood fill).
     * @param lowOffset - Amount subtracted from `epsilon` to form the low
     *   (weak-edge) bound (default: 0.2). Pixels at or above `epsilon - lowOffset`
     *   but below the high bound are classified as weak edges, which only survive
     *   in the output if connected to a strong edge.
     */
    constructor(highOffset?: number, lowOffset?: number);
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    private floodFill;
}

type threshold_HardThresholdStrategy = HardThresholdStrategy;
declare const threshold_HardThresholdStrategy: typeof HardThresholdStrategy;
type threshold_HysteresisThresholdStrategy = HysteresisThresholdStrategy;
declare const threshold_HysteresisThresholdStrategy: typeof HysteresisThresholdStrategy;
type threshold_SoftThresholdStrategy = SoftThresholdStrategy;
declare const threshold_SoftThresholdStrategy: typeof SoftThresholdStrategy;
type threshold_ThresholdConfig = ThresholdConfig;
type threshold_ThresholdStrategy = ThresholdStrategy;
declare namespace threshold {
  export { threshold_HardThresholdStrategy as HardThresholdStrategy, threshold_HysteresisThresholdStrategy as HysteresisThresholdStrategy, threshold_SoftThresholdStrategy as SoftThresholdStrategy };
  export type { threshold_ThresholdConfig as ThresholdConfig, threshold_ThresholdStrategy as ThresholdStrategy };
}

/**
 * Configuration for Difference of Gaussians processing
 *
 * Uses the reparameterized formulation from Section 2.5 of the paper:
 * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
 *
 * This decouples edge sharpening strength (p) from threshold parameters,
 * making the filter much easier to control.
 */
interface DoGConfig {
    /**
     * Base blur sigma for edge detection (default: 1.0)
     * Controls the scale of detected edges - larger values detect coarser edges
     * Paper typically uses 0.4-2.0 for most styles
     */
    sigma: number;
    /**
     * Ratio between the two Gaussian blur sizes (default: 1.6)
     * Paper recommends k = 1.6 as a good engineering trade-off
     * This approximates the Laplacian of Gaussian
     */
    k: number;
    /**
     * Sharpening strength parameter 'p' from Equation 7 (default: 20)
     * Controls the strength of edge emphasis
     * - p ≈ 0: No edge enhancement, just blurred image
     * - p ≈ 20: Strong edges suitable for thresholding (paper's typical value)
     * - p ≈ 100+: Extreme edge emphasis for woodcut style
     *
     * Note: This replaces the original τ parameter. The relationship is:
     * p = τ / (τ - 1), or equivalently τ = p / (p + 1)
     */
    p: number | ChannelImage;
    /**
     * Threshold for white vs black transition (default: 0.5)
     * Values above this become white, values below follow the soft threshold
     * Should be in 0-1 range for normalized images
     * Paper's Appendix A shows values around 0.72-0.88 (normalized from 0-100)
     */
    epsilon: number | ChannelImage;
    /**
     * Sharpness of the soft threshold / tanh steepness (default: 10)
     * Controls the transition sharpness between black and white
     * - φ ≈ 0.01: Very soft transitions (pencil shading, pastel)
     * - φ ≈ 1-10: Moderate transitions
     * - φ >> 10: Hard black/white threshold (approaches step function)
     */
    phi: number | ChannelImage;
    /**
     * Strategy used to convert the sharpened DoG response into the final output image
     *
     * Decouples how thresholding is performed from the edge-detection/sharpening
     * pipeline (sigma, k, p).  Allows swapping strategies without touching the rest of the config.
     * Consumes `epsilon` and `phi` from this config as its ThresholdConfig.
     *
     * Built-in strategies (see threshold.ts):
     * - `SoftThresholdStrategy`: tanh-based soft transition, governed by `phi`
     *   (steepness) and `epsilon` (midpoint). Produces the smooth pencil/pastel-to-hard-edge
     *   range described by `phi` above. This is the paper's standard XDoG threshold.
     * - `HardThresholdStrategy`: binary step function at `epsilon` (ignores `phi`).
     *   Equivalent to the φ → ∞ limit of the soft strategy; suited to styles like ADoG
     *   that expect a strictly binarized screentone output.
     * - `HysteresisThresholdStrategy`: Canny-style double threshold with flood-fill
     *   linking, using `epsilon ± highOffset/lowOffset` as the high/low bounds. Produces
     *   cleaner, more connected edge lines than a single global threshold, at the cost
     *   of ignoring `phi` and requiring a full-image connectivity pass.
     */
    thresholdStrategy: ThresholdStrategy;
}
/**
 * XDoG configuration combining DoG parameters with isotropic blur options
 */
interface XDoGConfig extends DoGConfig {
    /** Kernel size multiplier for Gaussian blur (default: 6) */
    kernelSizeMultiplier?: number;
    blurStrategy?: BlurStrategy;
}
/**
 * Extended configuration for Flow-based DoG (FDoG)
 *
 * FDoG uses three separate sigma parameters as described in Section 2.6:
 */
interface FDoGConfig extends DoGConfig {
    /**
     * σc: Structure tensor smoothing sigma (default: 2.5)
     * Controls the scale of the edge tangent flow computation
     * - Small values: More noise in flow field, captures fine edges
     * - Large values: Smoother flow, may distort fine features
     */
    sigmaC: number;
    /**
     * σe: Edge detection sigma - same as 'sigma' in base DoGConfig
     * Controls the width of gradient-aligned DoG filter
     * Larger values discard more fine details and result in wider edge lines
     */
    /**
     * σm: Flow-aligned smoothing sigma for line integral convolution (default: 3.0)
     * Controls the coherence of edge lines
     * - Small values: Short, potentially disconnected edges
     * - Large values: Long, coherent edges (may introduce noise if >> σc)
     */
    sigmaM: number;
    /**
     * σa: Anti-aliasing LIC sigma (default: 1.0)
     * Applied as a post-processing step along the ETF
     * - 0: No anti-aliasing
     * - 0.5-2: Typical anti-aliasing
     * - >2: Stylistic smoothing effect
     */
    sigmaA: number;
    /**
     * Number of smoothing iterations applied when computing the Edge Tangent Flow (ETF)
     *
     * The ETF is built iteratively by locally averaging tangent directions with
     * neighboring pixels, progressively refining the flow field so it follows
     * coherent edge structures rather than noisy per-pixel gradients (default: 3)
     * - 0-1: Flow field closely follows raw gradients; noisy, jagged edge directions
     * - 2-4: Typical range; smooth, stable flow suitable for line integral convolution
     * - 5+: Very smooth flow, but expensive and can over-round sharp corners/junctions
     *
     * This directly affects the quality of edges produced during LIC-based smoothing
     * (governed by sigmaM/sigmaA) an under-converged ETF will propagate noise into
     * the final stylized lines regardless of how sigmaM/sigmaA are tuned.
     */
    etfIterations?: number;
}
/**
 * Configuration for Adaptive Difference of Gaussians (ADoG)
 *
 * Based on Section 3.2, Eqs. (3)-(6) of "Gaussian Image Binarization"
 * (Kang & Stamoulis, 2021). ADoG modifies the DoG contrast-sensitivity
 * parameter to be a function of local tone, producing a screentoning effect
 * whose primitive density is inversely proportional to brightness.
 *
 * Note: 'sigma' (inherited from DoGConfig) plays the role of σc, and
 * 'k' plays the role of the σs/σc ratio (σs = k * σc), matching the
 * paper's defaults of σc = 1.0 and σs = 1.6σc.
 */
interface ADoGConfig extends DoGConfig {
    /**
     * τ: minimum contrast sensitivity (default: 0.99)
     * ρ(x) ranges within [τ, 1]. Higher values produce noisier responses.
     * Paper restricts τ to [0.97, 1.0].
     */
    tau: number;
    /**
     * s: controls the steepness of tone-dependent falloff in ρ(x) (Eq. 5)
     * and in the adaptive noise scale σ(x) (Eq. 6) (default: 2.0)
     * Larger s concentrates the density transition into darker tones.
     */
    s: number;
    /**
     * Adaptive noise scale factor 'c' in Eq. (6) (default: 0.01)
     * Set to 0 to disable noise injection entirely (Eq. 6 is optional --
     * see Fig. 8 in the paper for the effect of enabling it).
     */
    noiseScaleC: number;
    /**
     * Kernel size multiplier for the isotropic Gaussian blur (default: 6)
     * Same meaning as XDoGConfig's kernelSizeMultiplier.
     */
    kernelSizeMultiplier?: number;
}
/**
 * Configuration for Hybrid Difference of Gaussians (HDoG)
 *
 * Combines FDoG (line drawing) with two ADoG passes at different scales,
 * per Eq. (9): HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
 */
interface HDoGConfig {
    /** Configuration passed to the internal FDoG instance */
    fdog: Partial<FDoGConfig>;
    /**
     * Configuration passed to the primary ADoG instance (uses its own 's').
     * The secondary ADoG pass reuses this config but overrides 's' with
     * s * adogSecondaryScaleFactor (Eq. 9).
     */
    adog: Partial<ADoGConfig>;
    /**
     * s' = adogSecondaryScaleFactor * s, per Eq. (9) (default: 4)
     * Generates additional screentone in the darkest regions without
     * affecting brighter ones (paper empirically sets s' = 4s).
     */
    adogSecondaryScaleFactor: number;
    /**
     * Optional partial override applied on top of the derived secondary
     * ADoG config (primary config + s' = adogSecondaryScaleFactor * s).
     * Use this to tweak individual fields (e.g. epsilon, phi) for the
     * secondary pass without re-specifying the whole config.
     */
    adogSecondary?: Partial<ADoGConfig>;
}
interface DoGProcessingResult {
    /** Final thresholded output */
    result: ChannelImage;
    /** Sharpened image before thresholding */
    sharpened: ChannelImage;
    /** Raw DoG response (blur1 - blur2) */
    rawDoG?: ChannelImage;
}
/**
 * Result of HDoG processing.
 *
 * Structurally compatible with DoGProcessingResult (result and sharpened
 * are present), so this satisfies DoGImplementation.processDetailed()'s
 * return type. `sharpened` is set to the FDoG pass's sharpened image as a
 * representative value -- HDoG has no single "sharpened" stage of its own,
 * since it combines three already-binarized outputs. Callers holding a
 * concrete HDoG get the full per-pass breakdown via fdogResult /
 * adogPrimaryResult / adogSecondaryResult.
 */
interface HDoGProcessingResult extends DoGProcessingResult {
    fdogResult: ChannelImage;
    adogPrimaryResult: ChannelImage;
    adogSecondaryResult: ChannelImage;
}
/**
 * Result of ADoG processing, extending the standard DoGProcessingResult
 * with ADoG-specific intermediate artifacts.
 *
 * This is structurally compatible with DoGProcessingResult (result,
 * sharpened, and rawDoG are all present with matching types), so it
 * satisfies DoGImplementation.processDetailed()'s return type. Callers
 * holding a concrete ADoG (rather than the generic DoGImplementation
 * interface) additionally get rhoMap and noisyInput; nothing is lost, it's
 * just not visible through the narrower interface type.
 *
 * Field mapping vs. XDoG/FDoG's use of "sharpened"/"rawDoG":
 *   - rawDoG: the UNWEIGHTED response G_σc - G_σs (ρ ≡ 1), i.e. standard
 *     DoG -- this is what Fig. 7(b) in the paper compares against.
 *   - sharpened: the ρ(x)-WEIGHTED response (Eq. 4), pre-threshold. It's
 *     not an unsharp-mask "sharpened" image the way XDoG uses the term,
 *     but it plays the same structural role (pre-threshold DoG response).
 */
interface ADoGProcessingResult extends DoGProcessingResult {
    /** Per-pixel adaptive contrast sensitivity ρ(x), Eq. (5) */
    rhoMap: ChannelImage;
    /** Input after adaptive noise injection (Eq. 6), or the original input if noiseScaleC === 0 */
    noisyInput: ChannelImage;
}
/**
 * Interface for DoG processors (XDoG, FDoG, ADoG, or HDoG)
 */
interface DoGImplementation {
    process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /** Process and return all intermediate results (avoids redundant blur operations) */
    processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;
    dispose(): void;
}
interface ParamRange {
    hardMin: number;
    hardMax: number;
    recommendedMin: number;
    recommendedMax: number;
    default: number;
    step: number;
}
type DogConfigParamType = 'sigma' | 'k' | 'p' | 'epsilon' | 'phi';
/**
 * Base DoG / XDoG parameter ranges.
 *
 * Recommended ranges follow the span of settings in Table A.1 of
 * Winnemöller et al., "XDoG: An eXtended difference-of-Gaussians
 * compendium" (Computers & Graphics 36(6), 2012), which is the reference
 * for the reparameterized (σ, k, p, φ, ε) formulation used here. In that
 * table p ranges 15.7–120, φ ranges 0.01–10.3 (with φ >> 0.01 pushing the
 * soft tanh ramp toward a step function — Sec. 4.1), and ε ranges 72.6–100
 * on the paper's 0–100 luminance scale, i.e. ~0.73–1.0 once normalized.
 * σe (== `sigma` here) ranges 0.8–6.8 across natural-media styles.
 * k = 1.6 is Marr & Hildreth's engineering trade-off (Sec. 2.3).
 */
declare const DOG_PARAM_RANGES: Record<DogConfigParamType, ParamRange>;
type XDogConfigParamType = 'kernelSizeMultiplier';
/**
 * XDoG-specific parameter ranges (on top of DOG_PARAM_RANGES).
 *
 * kernelSizeMultiplier is the Gaussian truncation radius as a multiple of
 * σ. Winnemöller samples the Gaussian out to ~2σ for the DoG passes
 * (Appendix A/B), but a wider window (≈6σ) captures the tail more fully;
 * 3σ covers ~99.7% and is the practical floor for a clean kernel.
 */
declare const XDOG_PARAM_RANGES: Record<DogConfigParamType | XDogConfigParamType, ParamRange>;
/**
 * FDoG-specific parameter ranges (on top of DOG_PARAM_RANGES).
 *
 * Ranges follow Table A.1: σc 0.10–5.84, σm 3.2–20, σa 0.6–7.2. σe is the
 * base `sigma` and keeps its DOG_PARAM_RANGES entry. Defaults track the
 * paper's more conservative line-drawing settings rather than the extreme
 * pastel/woodcut ends of the table.
 */
type FDogConfigParamType = 'sigmaC' | 'sigmaM' | 'sigmaA';
declare const FDOG_PARAM_RANGES: Record<DogConfigParamType | FDogConfigParamType, ParamRange>;
/**
 * ADoG parameter ranges.
 *
 * ADoG overrides several base ranges to match its own operating regime
 * (Gaussian Image Binarization, Sec. 3.2):
 *   - k: fixed by σs = 1.6σc, so the recommended band tightens to 1.6.
 *   - epsilon/phi: ADoG binarizes with a HARD threshold, so ε sits low
 *     (screentone primitives are dark-on-white) and φ is driven high to
 *     approximate a step function. These differ from the base DoG ranges,
 *     which are tuned for XDoG's soft tone-mapping.
 *   - tau, s, noiseScaleC: ADoG's own contrast-sensitivity and noise knobs.
 */
type ADogConfigParamType = 'tau' | 's' | 'noiseScaleC' | 'kernelSizeMultiplier';
declare const ADOG_PARAM_RANGES: Record<DogConfigParamType | ADogConfigParamType, ParamRange>;
type HDogConfigParamType = ADogConfigParamType | 'adogSecondaryScaleFactor';
/** HDoG shares ADoG's parameter regime (its screentone passes are ADoG). */
declare const HDOG_PARAM_RANGES: Record<DogConfigParamType | HDogConfigParamType, ParamRange>;
/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
declare const DEFAULT_DOG_CONFIG: DoGConfig;
/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
declare const DEFAULT_FDOG_CONFIG: FDoGConfig;
/**
 * Default ADoG configuration values
 * Based on Section 3.2 of "Gaussian Image Binarization"
 * (σc = 1.0, σs = 1.6σc, τ = 0.99, s = 2.0, noise c = 0.01)
 */
declare const DEFAULT_ADOG_CONFIG: ADoGConfig;
/**
 * Default HDoG configuration values
 * s' defaults to 4s per the paper's empirical setting (Eq. 9)
 */
declare const DEFAULT_HDOG_CONFIG: HDoGConfig;
/**
 * Preset configurations for common styles from the paper
 */
declare const STYLE_PRESETS: Record<string, DoGConfig>;
/**
 * Preset FDoG configurations including flow parameters
 */
declare const FDOG_STYLE_PRESETS: Record<string, FDoGConfig>;
/**
 * Preset ADoG configurations
 * (No presets given directly in the paper's tables beyond the defaults
 * above; add named presets here as you tune them, e.g. denser/lighter
 * screentone variants.)
 */
declare const ADOG_STYLE_PRESETS: Record<string, ADoGConfig>;
declare const HDOG_STYLE_PRESETS: Record<string, HDoGConfig>;

/**
 * High-level XDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */

/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 *
 * This implements the reparameterized XDoG from Section 2.5 of the paper,
 * using Equation 7 for the sharpening computation.
 */
declare class XDoG implements DoGImplementation {
    private config;
    private dogConfig;
    private blurStrategyPromise;
    constructor(config?: Partial<XDoGConfig>);
    dispose(): void;
    /**
     * Create XDoG with a preset style
     */
    static withPreset(presetName: keyof typeof STYLE_PRESETS): XDoG;
    private getProcessor;
    /**
     * Process a grayscale image
     */
    process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process without thresholding (returns sharpened image)
     */
    processSharpened(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Get raw DoG response for visualization
     */
    processRawDoG(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process and return all intermediate results
     *
     * This is more efficient than calling process(), processSharpened(), and
     * processRawDoG() separately as it only performs the blur operations once.
     *
     * Useful for:
     * - Hatching strategies that need the sharpened image
     * - Debugging and visualization
     * - Custom post-processing pipelines
     */
    processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    processGrayscaleImageData(input: ImageData, overrides?: Partial<DoGConfig>): Promise<ImageData>;
    /**
     * Get current configuration.
     */
    getConfig(): Readonly<XDoGConfig>;
    setConfig(config: Partial<XDoGConfig>): void;
}
/**
 * Convenience function for one-shot XDoG processing
 */
declare function xdog(input: ChannelImage, config?: Partial<XDoGConfig>): Promise<ChannelImage>;

/**
 * High-level FDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */

/**
 * FDoG (Flow-based Difference of Gaussians)
 *
 * Uses flow-guided blur along edge tangent directions for coherent line drawing.
 * Produces smoother, more artistic results similar to hand-drawn illustrations.
 *
 * This implements the full FDoG pipeline from Section 2.6:
 * 1. Compute Edge Tangent Flow (ETF) from structure tensor
 * 2. Apply gradient-aligned DoG (across edges)
 * 3. Apply flow-aligned smoothing (along edges)
 * 4. Apply soft thresholding
 * 5. Optional: Apply anti-aliasing LIC pass
 *
 * Parameters:
 * - σc: Structure tensor smoothing (controls ETF smoothness)
 * - σe: Edge detection sigma (controls edge width)
 * - σm: Flow-aligned smoothing (controls line coherence)
 * - σa: Anti-aliasing sigma (optional post-processing)
 */
declare class FDoG implements DoGImplementation {
    private config;
    constructor(config?: Partial<FDoGConfig>);
    dispose(): void;
    /**
     * Create FDoG with a preset style
     */
    static withPreset(presetName: keyof typeof FDOG_STYLE_PRESETS): FDoG;
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the full pipeline runs fresh each time.
     */
    process(input: ChannelImage, overrides?: Partial<FDoGConfig>): Promise<ChannelImage>;
    /**
     * Process with more control over individual stages
     */
    processDetailed(input: ChannelImage, overrides?: Partial<FDoGConfig>): Promise<{
        result: ChannelImage;
        etf: FlowField;
        sharpened: ChannelImage;
        thresholded: ChannelImage;
        smoothed: ChannelImage;
    }>;
    /**
     * Convenience method to process ImageData directly
     */
    processGrayscaleImageData(input: ImageData, overrides?: Partial<FDoGConfig>): Promise<ImageData>;
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    processWithETF(input: ChannelImage, etf: FlowField, overrides?: Partial<FDoGConfig>): Promise<ChannelImage>;
    /**
     * Apply only the anti-aliasing pass to an already-processed image
     */
    applyAntiAliasing(input: ChannelImage, etf: FlowField, sigmaA?: number): Promise<ChannelImage>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<FDoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<FDoGConfig>): void;
}
/**
 * Convenience function for one-shot FDoG processing
 */
declare function fdog(input: ChannelImage, config?: Partial<FDoGConfig>): Promise<ChannelImage>;

/**
 * High-level ADog implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */

declare class ADoG implements DoGImplementation {
    private config;
    private blurStrategy;
    constructor(config?: Partial<ADoGConfig>);
    dispose(): void;
    /**
     * Estimate a good `epsilon` for a given input + config by running the
     * ADoG pipeline once and taking the mean of the (pre-threshold) sharpened
     * response. Since ADoG's response straddles the true edge/noise "zero"
     * around the local mean rather than a fixed absolute constant (see Eq. 4/5),
     * a fixed epsilon default doesn't transfer across images, tau/s/noiseScaleC
     * choices, or resolutions -- this recomputes it per-input instead.
     *
     * @param biasOffset Shifts the estimate away from the raw mean to bias
     *   density (positive -> denser/more black). Default 0 (balanced 50/50).
     */
    static estimateEpsilon(input: ChannelImage, config?: Partial<ADoGConfig>, biasOffset?: number): Promise<number>;
    static estimateSigma(input: ChannelImage, { referenceDimension, baseSigma }?: {
        referenceDimension?: number;
        baseSigma?: number;
    }): number;
    /**
     * Process a grayscale image through the ADoG pipeline.
     */
    process(input: ChannelImage, overrides?: Partial<ADoGConfig>): Promise<ChannelImage>;
    processDetailed(input: ChannelImage, overrides?: Partial<ADoGConfig>): Promise<ADoGProcessingResult>;
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas),
     * matching XDoG/FDoG's convenience method of the same name.
     */
    processGrayscaleImageData(input: ImageData, overrides?: Partial<ADoGConfig>): Promise<ImageData>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<ADoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<ADoGConfig>): Promise<void>;
    /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
    private computeRhoMap;
    /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
    private injectAdaptiveNoise;
    /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
    private computeWeightedDoG;
    /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
    private computeUnweightedDoG;
}
/**
 * Convenience function for one-shot ADoG processing, matching xdog()/fdog()
 * in dog.ts
 */
declare function adog(input: ChannelImage, config?: Partial<ADoGConfig>): Promise<ChannelImage>;

/**
 * High-level HDoG implementations
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 */

declare class HDoG implements DoGImplementation {
    private fdog;
    private adogPrimary;
    private adogSecondary;
    constructor(config?: Partial<HDoGConfig>);
    dispose(): void;
    /**
     * Eq. (9): HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
     *
     * Note: HDoG's own configuration (fdog/adog/adogSecondaryScaleFactor) is
     * nested rather than a flat DoGConfig, so per-call overrides aren't
     * exposed here the way XDoG/FDoG/ADoG expose them -- there's no clean way
     * to map a flat Partial<DoGConfig> onto "override the nested fdog config,
     * or the nested adog config, or the scale factor". Configure via the
     * constructor; if you need per-call tuning, consider adding a dedicated
     * method (e.g. processWithConfig(input, HDoGConfig overrides)) rather than
     * overloading `process`.
     */
    process(input: ChannelImage): Promise<ChannelImage>;
    processDetailed(input: ChannelImage): Promise<HDoGProcessingResult>;
}
/**
 * Convenience function for one-shot HDoG processing, matching xdog()/fdog()
 * in dog.ts and adog() in adog.ts
 */
declare function hdog(input: ChannelImage, config?: Partial<HDoGConfig>): Promise<ChannelImage>;

declare const index$4_ADOG_PARAM_RANGES: typeof ADOG_PARAM_RANGES;
declare const index$4_ADOG_STYLE_PRESETS: typeof ADOG_STYLE_PRESETS;
type index$4_ADoG = ADoG;
declare const index$4_ADoG: typeof ADoG;
type index$4_ADoGConfig = ADoGConfig;
type index$4_ADoGProcessingResult = ADoGProcessingResult;
type index$4_ADogConfigParamType = ADogConfigParamType;
declare const index$4_DEFAULT_ADOG_CONFIG: typeof DEFAULT_ADOG_CONFIG;
declare const index$4_DEFAULT_DOG_CONFIG: typeof DEFAULT_DOG_CONFIG;
declare const index$4_DEFAULT_FDOG_CONFIG: typeof DEFAULT_FDOG_CONFIG;
declare const index$4_DEFAULT_HDOG_CONFIG: typeof DEFAULT_HDOG_CONFIG;
declare const index$4_DOG_PARAM_RANGES: typeof DOG_PARAM_RANGES;
type index$4_DoGConfig = DoGConfig;
type index$4_DoGImplementation = DoGImplementation;
type index$4_DogConfigParamType = DogConfigParamType;
declare const index$4_FDOG_PARAM_RANGES: typeof FDOG_PARAM_RANGES;
declare const index$4_FDOG_STYLE_PRESETS: typeof FDOG_STYLE_PRESETS;
type index$4_FDoG = FDoG;
declare const index$4_FDoG: typeof FDoG;
type index$4_FDoGConfig = FDoGConfig;
type index$4_FDogConfigParamType = FDogConfigParamType;
declare const index$4_HDOG_PARAM_RANGES: typeof HDOG_PARAM_RANGES;
declare const index$4_HDOG_STYLE_PRESETS: typeof HDOG_STYLE_PRESETS;
type index$4_HDoG = HDoG;
declare const index$4_HDoG: typeof HDoG;
type index$4_HDoGConfig = HDoGConfig;
type index$4_HDoGProcessingResult = HDoGProcessingResult;
type index$4_HDogConfigParamType = HDogConfigParamType;
type index$4_ParamRange = ParamRange;
declare const index$4_STYLE_PRESETS: typeof STYLE_PRESETS;
declare const index$4_XDOG_PARAM_RANGES: typeof XDOG_PARAM_RANGES;
type index$4_XDoG = XDoG;
declare const index$4_XDoG: typeof XDoG;
type index$4_XDoGConfig = XDoGConfig;
type index$4_XDogConfigParamType = XDogConfigParamType;
declare const index$4_adog: typeof adog;
declare const index$4_fdog: typeof fdog;
declare const index$4_hdog: typeof hdog;
declare const index$4_xdog: typeof xdog;
declare namespace index$4 {
  export { index$4_ADOG_PARAM_RANGES as ADOG_PARAM_RANGES, index$4_ADOG_STYLE_PRESETS as ADOG_STYLE_PRESETS, index$4_ADoG as ADoG, index$4_DEFAULT_ADOG_CONFIG as DEFAULT_ADOG_CONFIG, index$4_DEFAULT_DOG_CONFIG as DEFAULT_DOG_CONFIG, index$4_DEFAULT_FDOG_CONFIG as DEFAULT_FDOG_CONFIG, index$4_DEFAULT_HDOG_CONFIG as DEFAULT_HDOG_CONFIG, index$4_DOG_PARAM_RANGES as DOG_PARAM_RANGES, index$4_FDOG_PARAM_RANGES as FDOG_PARAM_RANGES, index$4_FDOG_STYLE_PRESETS as FDOG_STYLE_PRESETS, index$4_FDoG as FDoG, index$4_HDOG_PARAM_RANGES as HDOG_PARAM_RANGES, index$4_HDOG_STYLE_PRESETS as HDOG_STYLE_PRESETS, index$4_HDoG as HDoG, index$4_STYLE_PRESETS as STYLE_PRESETS, index$4_XDOG_PARAM_RANGES as XDOG_PARAM_RANGES, index$4_XDoG as XDoG, index$4_adog as adog, index$4_fdog as fdog, index$4_hdog as hdog, index$4_xdog as xdog };
  export type { index$4_ADoGConfig as ADoGConfig, index$4_ADoGProcessingResult as ADoGProcessingResult, index$4_ADogConfigParamType as ADogConfigParamType, index$4_DoGConfig as DoGConfig, index$4_DoGImplementation as DoGImplementation, index$4_DogConfigParamType as DogConfigParamType, index$4_FDoGConfig as FDoGConfig, index$4_FDogConfigParamType as FDogConfigParamType, index$4_HDoGConfig as HDoGConfig, index$4_HDoGProcessingResult as HDoGProcessingResult, index$4_HDogConfigParamType as HDogConfigParamType, index$4_ParamRange as ParamRange, index$4_XDoGConfig as XDoGConfig, index$4_XDogConfigParamType as XDogConfigParamType };
}

/**
 * Difference of Gaussians processor
 *
 * This is the core processor that can be used for both XDoG (with IsotropicBlur)
 * and FDoG (with FlowGuidedBlur).
 *
 * Implements the reparameterized formulation from Section 2.5 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */

/**
 * Difference of Gaussians processor
 *
 * Uses the reparameterized formulation (Equation 7):
 * S_σ,k,p(x) = G_σ(x) + p x D_σ,k(x) = (1 + p) x G_σ(x) - p x G_kσ(x)
 *
 * This is equivalent to unsharp masking of the blurred image, which
 * decouples edge sharpening strength (p) from threshold parameters.
 *
 * The blur strategy can be swapped to get different effects:
 * - IsotropicBlur: Standard XDoG with uniform blur
 * - FlowGuidedBlur: FDoG with edge-coherent blur
 * - GradientAlignedBlur: Blur across edges only
 */
declare class DoGProcessor {
    private config;
    private blurStrategy;
    private thresholdStrategy;
    constructor(blurStrategy: BlurStrategy, config?: Partial<DoGConfig>);
    dispose(): void;
    /**
     * Process an image through the DoG pipeline
     *
     * Pipeline:
     * 1. Apply two Gaussian blurs with different sigma values
     * 2. Compute sharpened image using Equation 7
     * 3. Apply soft thresholding using Equation 5
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Processed image with edges detected and stylized
     */
    process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process without thresholding - returns the sharpened image
     * Useful for debugging or custom post-processing
     */
    processNoThreshold(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Get the raw DoG response (without sharpening or thresholding)
     * Useful for visualization and debugging
     */
    processRawDoG(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process and return all intermediate results in a single pass
     *
     * This is more efficient than calling process(), processNoThreshold(), and
     * processRawDoG() separately as it only performs the blur operations once.
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Object containing result, sharpened, and rawDoG images
     */
    processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<DoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<DoGConfig>): void;
    /**
     * Replace blur strategy
     */
    setBlurStrategy(strategy: BlurStrategy): void;
    /**
     * Compute raw Difference of Gaussians: D(x) = G_σ(x) - G_kσ(x)
     * This is the standard DoG without any weighting
     */
    private computeDoG;
    /**
     * Compute sharpened image using Equation 7 from the paper:
     * S_σ,k,p(x) = G_σ(x) + p x D_σ,k(x) = (1 + p) x G_σ(x) - p x G_kσ(x)
     *
     * This can be understood as unsharp masking of the blurred image.
     * The parameter p controls the edge sharpening strength independently
     * of the threshold parameters.
     *
     * @param blur1 G_σ * I (smaller blur)
     * @param blur2 G_kσ * I (larger blur)
     * @param p Sharpening strength (p ≈ 20 typical, p ≈ 100 for woodcut)
     */
    private computeSharpening;
    /**
     * Apply thresholding using the configured strategy
     * This creates the characteristic XDoG stylization:
     * - Values above ε become white (1)
     * - Values below ε get soft-thresholded with tanh
     * - φ controls the sharpness of the transition
     *
     * @param sharpened Sharpened image from computeSharpening
     * @param epsilon Threshold value (typically around 0.5-0.8 for normalized images)
     * @param phi Threshold sharpness (0.01 = soft, 100 = near step function)
     */
    private applyThreshold;
}
/**
 * Alternative thresholding modes that can be used for different effects
 * These can be applied to the sharpened image manually for custom styles
 */
declare const ThresholdModes: {
    /**
     * Hard black and white threshold (step function)
     * Equivalent to φ → ∞ in the soft threshold
     */
    hard: (value: number, epsilon: number) => number;
    /**
     * Soft threshold (default XDoG style, Equation 5)
     */
    soft: (value: number, epsilon: number, phi: number) => number;
    /**
     * Three-tone (white, gray, black) for sketch effect
     * Creates a posterized look with three distinct values
     */
    threeTone: (value: number, epsilon: number, midPoint?: number) => number;
    /**
     * Multi-tone quantization
     * Quantizes to n discrete levels
     */
    multiTone: (value: number, levels: number) => number;
    /**
     * Continuous (no thresholding) - useful for seeing raw sharpened output
     * Maps the range to 0-1 for visualization
     */
    continuous: (value: number) => number;
    /**
     * Smooth curve approximating three-value quantization
     * Used for Figure 7(c) in the paper
     */
    smoothThreeTone: (value: number, epsilon: number, phi: number) => number;
};
/**
 * Apply a custom threshold function to a grayscale image
 */
declare function applyCustomThreshold(input: ChannelImage, thresholdFn: (value: number) => number): ChannelImage;

declare class BaseCPUStrategy {
    readonly backend: "cpu";
    dispose(): void;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): string | undefined;
}
declare class BaseWebGLStrategy {
    readonly backend: "webgl";
    dispose(): void;
    static isSupported(): Promise<boolean>;
    /**
     * Get reason if WebGL2 is not supported.
     *
     * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
     * even though this base implementation itself is synchronous, so that
     * subclasses that need to probe the shared/module-level GL context
     * asynchronously can override it without a static-side type conflict.
     */
    static getUnsupportedReason(): string | undefined | Promise<string | undefined>;
    /**
     * WebGL errors are synchronous — no scopes, just drain-then-check.
     * See discussion in webgl.ts for why this is needed.
     */
    protected runGuarded<T>(gl: WebGL2RenderingContext, fn: () => T): T;
}
declare class BaseWebGPUStrategy {
    readonly backend: "webgpu";
    dispose(): void;
    protected static cachedAdapter: GPUAdapter | null;
    protected static cachedDevice: GPUDevice | null;
    protected static devicePromise: Promise<GPUDevice | null> | null;
    protected static adapterInfo: GPUAdapterInfo | null;
    protected static isSoftwareRenderer: boolean;
    /**
     * Check if WebGPU is supported (sync check - just API availability)
     */
    static isSupported(): Promise<boolean>;
    /**
     * Get reason if WebGPU is not supported.
     *
     * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
     * even though this base implementation itself is synchronous, so that
     * subclasses that need to request an adapter to confirm availability
     * can override it without a static-side type conflict.
     */
    static getUnsupportedReason(): string | undefined | Promise<string | undefined>;
    /**
     * Check if the adapter is a software/fallback renderer (call after getWebGPUDevice)
     */
    static isFallbackAdapter(): boolean;
    /**
     * Get adapter info (call after getWebGPUDevice)
     */
    static getAdapterInfo(): GPUAdapterInfo | null;
    /**
     * Async check if WebGPU is actually usable with hardware acceleration
     * Returns false for software renderers like SwiftShader
     */
    static isAvailable(allowSoftware?: boolean): Promise<boolean>;
    /**
     * Detect if adapter is a software renderer
     */
    private static detectSoftwareRenderer;
    /**
     * Get or create WebGPU device (shared)
     */
    static getWebGPUDevice(): Promise<GPUDevice | null>;
    /**
     * WebGPU errors are async (error scopes). See discussion in
     * webgpu.ts for why try/catch alone misses these.
     */
    protected runGuarded<T>(device: GPUDevice, fn: () => T | Promise<T>): Promise<T>;
}

/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */

/**
 * Configuration for isotropic Gaussian blur
 */
interface BaseIsotropicBlurConfig {
    /**
     * Kernel size multiplier relative to sigma (default: 6, meaning 3σ on each side)
     * Paper samples at 2× sigma for flow-aligned, 2.45× for structure tensor
     */
    kernelSizeMultiplier: number;
}
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
declare class CPUIsotropicBlur extends BaseCPUStrategy implements BlurStrategy {
    private config;
    constructor(config?: Partial<BaseIsotropicBlurConfig>);
    /** CPU is always available — it's the universal fallback. */
    static isSupported(): Promise<boolean>;
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
/**
 * Configuration for WebGL blur
 */
interface WebGLBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 63, limited by shader uniform array) */
    maxKernelSize: number;
}
/**
 * WebGL2-accelerated isotropic Gaussian blur
 * Uses separable convolution with two passes (horizontal + vertical)
 */
declare class WebGLIsotropicBlur extends BaseWebGLStrategy implements BlurStrategy {
    private config;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    constructor(config?: Partial<WebGLBlurConfig>);
    /**
     * Cheap synchronous-in-spirit check (wrapped in a resolved Promise to
     * satisfy `BlurStrategyCtor`) Excludes software
     * rasterizers, which are too slow to be a useful GPU fallback.
     */
    static isSupported(): Promise<boolean>;
    private initResources;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    private blurPass;
    dispose(): void;
}
/**
 * WebGPU configuration
 */
interface WebGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 63) */
    maxKernelSize: number;
}
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 *
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
declare class WebGPUIsotropicBlur extends BaseWebGPUStrategy implements BlurStrategy {
    private config;
    private resources;
    private paramsBuffer;
    private kernelBuffer;
    private inputBuffer;
    private tempBuffer;
    private outputBuffer;
    private currentBufferSize;
    private currentKernelSize;
    constructor(config?: Partial<WebGPUBlurConfig>);
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static isSupported(): Promise<boolean>;
    /**
     * Initialize WebGPU resources
     */
    private initResources;
    /**
     * Ensure buffers are sized correctly
     */
    private ensureBuffers;
    /**
     * Blur implementation - supports concurrent/parallel calls
     *
     * CCreates a new staging buffer for each operation instead of
     * reusing a single one, preventing "Buffer already has an outstanding
     * map pending" errors when blur() is called in parallel.
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Clean up GPU resources
     */
    dispose(): void;
}
type IsotropicBlurConfig = BaseIsotropicBlurConfig | WebGLBlurConfig | WebGPUBlurConfig;
/**
 * Backend-agnostic isotropic blur. Picks the best backend this device
 * actually supports for *this algorithm* (not a global session-wide
 * choice), and falls back to the next-best backend if the active one
 * fails mid-session (lost context, driver crash, etc.).
 *
 * Construction is async (`IsotropicBlur.create()`) because backend
 * detection is inherently async; constructors can't be async, so a
 * private constructor plus a static factory forces detection to
 * complete before the instance is usable.
 */
declare class IsotropicBlur implements BlurStrategy {
    private instance;
    private currentCtor;
    private config;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(config?: Partial<IsotropicBlurConfig>): Promise<IsotropicBlur>;
    get backend(): "webgpu" | "webgl" | "cpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Demotes the current backend and activates the next untried, supported
     * candidate. A single-step retry, not a cascading loop through every
     * remaining backend: cascading on one call risks masking a real input
     * bug (e.g. a bad sigma) as a backend problem.
     *
     * `failedBackends` is per-instance, not module-global — a transient
     * driver hiccup shouldn't permanently blacklist a backend for the whole
     * session.
     */
    private demoteAndFindNext;
}

/**
 * Flow-guided blur using line integral convolution along edge tangents
 * This is the blur used in FDoG for coherent line drawing
 *
 * The blur is computed by integrating pixel values along the flow direction,
 * weighted by a Gaussian kernel. This produces blur that follows edge contours
 * rather than blurring across them.
 */

interface FlowGuidedBlurStrategy {
    setFlowField(flowField: FlowField): void;
}
/**
 * Configuration for flow-guided blur
 */
interface CPUFlowGuidedBlurConfig {
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
declare class CPUFlowGuidedBlur extends BaseCPUStrategy implements BlurStrategy, FlowGuidedBlurStrategy {
    private flowField;
    private config;
    constructor(flowField: FlowField, config?: Partial<CPUFlowGuidedBlurConfig>);
    /** CPU is always available — it's the universal fallback. */
    static isSupported(): Promise<boolean>;
    dispose(): void;
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Sample along the flow direction using line integral convolution
     *
     * This follows the tangent field in both directions from the starting point,
     * accumulating weighted samples to produce a blur along the edge direction.
     */
    private sampleAlongFlow;
}
/**
 * WebGL2-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
declare class WebGLFlowGuidedBlur extends BaseWebGLStrategy implements BlurStrategy, FlowGuidedBlurStrategy {
    private config;
    private flowField;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    private flowTexture;
    constructor(flowField: FlowField, config?: Partial<GLGPUBlurConfig>);
    /**
     * Same check as WebGLIsotropicBlur: a real, hardware-accelerated WebGL2
     * context with float render targets, excluding software rasterizers.
     */
    static isSupported(): Promise<boolean>;
    private initResources;
    private ensureTextureSize;
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    dispose(): void;
}
/**
 * Configuration for WebGL blur
 */
interface GLGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 63, limited by shader uniform array) */
    maxKernelSize: number;
}
/**
 * Configuration for WebGPU blur
 */
interface GLGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 127) */
    maxKernelSize: number;
}
/**
 * WebGPU-accelerated flow-guided blur
 */
declare class WebGPUFlowGuidedBlur extends BaseWebGPUStrategy implements BlurStrategy, FlowGuidedBlurStrategy {
    private config;
    private flowField;
    private resources;
    private kernelBuffer;
    private currentKernelSize;
    private flowTexture;
    private flowFieldWidth;
    private flowFieldHeight;
    private flowDirty;
    private static readonly CPU_BAKE_ROWS_PER_CHUNK;
    private maxTileBytes;
    private static readonly TILE_MEMORY_SAFETY_FACTOR;
    constructor(flowField: FlowField, config?: Partial<GLGPUBlurConfig>);
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static isSupported(): Promise<boolean>;
    private initResources;
    /**
     * Textures are bound by maxTextureDimension2D (typically 8192-16384),
     * not the storage-buffer binding limit — but that ceiling still exists,
     * and silently exceeding it is exactly the failure mode this fix is
     * closing off. Throw a clear, catchable error instead, so the
     * FlowGuidedBlur wrapper's fallback logic gets a chance to demote to
     * WebGL/CPU rather than the caller getting corrupted output.
     */
    private assertWithinTextureLimits;
    /**
     * (Re)builds the flow-field texture for the given dimensions if it's
     * missing, stale (setFlowField() was called), or the wrong size. Built
     * in row-chunks rather than one Float32Array(width*height*2) for the
     * whole image, so preparing this for a large image doesn't itself blow
     * up JS heap before any GPU work happens.
     */
    private bakeFlowTexture;
    private getFlowTexture;
    /**
     * Update the flow field (e.g., when processing a new image). Marks the
     * cached flow texture dirty rather than rebuilding immediately — the
     * next blur() call rebuilds it (and only then, against the dimensions
     * that call actually needs).
     */
    setFlowField(flowField: FlowField): void;
    /**
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer — this is what
     * keeps memory flat for large images instead of scaling linearly with
     * width*height, and is what prevents the silent corruption/blank-out
     * described above. The input/flow textures are still one full-image
     * texture each (bounded by `maxTextureDimension2D`, checked via
     * `assertWithinTextureLimits`), which is a far higher ceiling than the
     * storage-buffer limit the old version was implicitly subject to.
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    dispose(): void;
}
type FlowGuidedBlurConfig = CPUFlowGuidedBlurConfig | GLGPUBlurConfig;
/**
 * Backend-agnostic flow-guided blur. Same per-algorithm backend selection
 * and single-retry fallback as `IsotropicBlur` — see that file for the
 * rationale on `create()`/`satisfies`/per-instance `failedBackends`/
 * single-step retry.
 *
 * One addition here: the flow field is mutable state (`setFlowField` swaps
 * it for a new frame), so it has to be tracked on the wrapper too — a
 * fallback needs to construct the next backend with the *current* flow
 * field, not the one from construction time.
 */
declare class FlowGuidedBlur implements BlurStrategy, FlowGuidedBlurStrategy {
    private instance;
    private currentCtor;
    private config;
    private flowField;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(flowField: FlowField, config?: Partial<FlowGuidedBlurConfig>): Promise<FlowGuidedBlur>;
    get backend(): "webgpu" | "webgl" | "cpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Update the flow field (e.g., when processing a new frame). Stored on
     * the wrapper too, so a later backend fallback hands the new instance
     * the current flow field rather than a stale one from construction time.
     */
    setFlowField(flowField: FlowField): void;
    private demoteAndFindNext;
}

declare class GradientAlignedBlur implements BlurStrategy {
    private instance;
    private currentCtor;
    private flowField;
    private config;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>): Promise<GradientAlignedBlur>;
    get backend(): "webgpu" | "webgl" | "cpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Propagates to whatever backend is currently running, and is also
     * remembered for any future backend constructed by demoteAndFindNext()
     * (fallback instances are built fresh via `new Ctor(config)`, so the
     * current flow field has to be threaded through `config` each time
     * rather than mutated on an existing instance).
     */
    setFlowField(flowField: FlowField): void;
    private demoteAndFindNext;
}

type index$3_CPUFlowGuidedBlur = CPUFlowGuidedBlur;
declare const index$3_CPUFlowGuidedBlur: typeof CPUFlowGuidedBlur;
type index$3_CPUIsotropicBlur = CPUIsotropicBlur;
declare const index$3_CPUIsotropicBlur: typeof CPUIsotropicBlur;
type index$3_FlowGuidedBlur = FlowGuidedBlur;
declare const index$3_FlowGuidedBlur: typeof FlowGuidedBlur;
type index$3_FlowGuidedBlurConfig = FlowGuidedBlurConfig;
type index$3_GradientAlignedBlur = GradientAlignedBlur;
declare const index$3_GradientAlignedBlur: typeof GradientAlignedBlur;
type index$3_IsotropicBlur = IsotropicBlur;
declare const index$3_IsotropicBlur: typeof IsotropicBlur;
type index$3_IsotropicBlurConfig = IsotropicBlurConfig;
type index$3_WebGLFlowGuidedBlur = WebGLFlowGuidedBlur;
declare const index$3_WebGLFlowGuidedBlur: typeof WebGLFlowGuidedBlur;
type index$3_WebGLIsotropicBlur = WebGLIsotropicBlur;
declare const index$3_WebGLIsotropicBlur: typeof WebGLIsotropicBlur;
type index$3_WebGPUFlowGuidedBlur = WebGPUFlowGuidedBlur;
declare const index$3_WebGPUFlowGuidedBlur: typeof WebGPUFlowGuidedBlur;
type index$3_WebGPUIsotropicBlur = WebGPUIsotropicBlur;
declare const index$3_WebGPUIsotropicBlur: typeof WebGPUIsotropicBlur;
declare namespace index$3 {
  export { index$3_CPUFlowGuidedBlur as CPUFlowGuidedBlur, index$3_CPUIsotropicBlur as CPUIsotropicBlur, index$3_FlowGuidedBlur as FlowGuidedBlur, index$3_GradientAlignedBlur as GradientAlignedBlur, index$3_IsotropicBlur as IsotropicBlur, index$3_WebGLFlowGuidedBlur as WebGLFlowGuidedBlur, index$3_WebGLIsotropicBlur as WebGLIsotropicBlur, index$3_WebGPUFlowGuidedBlur as WebGPUFlowGuidedBlur, index$3_WebGPUIsotropicBlur as WebGPUIsotropicBlur };
  export type { index$3_FlowGuidedBlurConfig as FlowGuidedBlurConfig, index$3_IsotropicBlurConfig as IsotropicBlurConfig };
}

/**
 * Edge Tangent Flow computer that automatically resolves to the best
 * supported backend, with graceful single-retry fallback if that backend
 * fails after selection (driver crash, lost context, etc).
 *
 */
declare class EdgeTangentFlowComputer implements ETFComputer {
    private instance;
    private currentCtor;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(): Promise<EdgeTangentFlowComputer>;
    /**
     * Which backend is actually running right now. Can change over the
     * life of this instance if a fallback occurs mid-session.
     */
    get backend(): "webgpu" | "webgl" | "cpu";
    dispose(): void;
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeDetailed(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<ETFDetailedResult>;
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannelDetailed(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<ETFDetailedResult>;
    callWithFallback<T>(op: (computer: ETFComputer) => Promise<T>): Promise<T>;
    private demoteAndFindNext;
}

/**
 * Local variance-based texture detection preprocessor for XDoG/FDoG edge detection.
 *
 * @remarks
 * Standard XDoG/FDoG apply the same parameters across an entire image, so
 * textured regions (fabric, foliage, skin) produce false edges alongside
 * genuine structural ones. This module addresses that by computing a texture
 * strength map — a {@link ChannelImage} whose values range from `0` (pure
 * structure) to `1` (pure texture) — from the local variance in a window
 * around each pixel, optionally normalized by the local gradient so that
 * subtle structural edges (e.g. wrinkles) aren't mistaken for texture.
 */

/**
 * Configuration for Local Variance Texture Detection
 *
 * These parameters control how texture is detected. They are independent
 * from XDoG/FDoG/HDoG parameters - you tune them separately based on the
 * image characteristics you're working with.
 */
interface LocalVarianceConfig {
    /**
     * Window radius for variance computation
     * Examples:
     * - 1 = 3x3 window (fast, fine detail)
     * - 2 = 5x5 window (recommended, balanced)
     * - 3 = 7x7 window (slower, coarser texture detection)
     */
    windowRadius: number;
    /**
     * Normalize by local gradient to distinguish texture from structure edges
     *
     * Without normalization:
     *   - High variance alone indicates texture
     *   - Problem: Subtle structural edges with variance get suppressed
     *
     * With normalization:
     *   - High variance + low gradient = texture (keep)
     *   - High variance + high gradient = edge (reduce texture score)
     *   - Formula: texture *= 1 / (1 + gradient^2)
     *
     * Recommended: true
     */
    normalizeByGradient: boolean;
    /**
     * Scale factor for raw variance values
     * Typical range: 1.0 - 3.0
     * Higher = more sensitive to texture variations
     * Output is clamped to [0, 1] after scaling
     */
    varianceScale: number;
    /**
     * Optional hard cap on variance values (before normalization)
     * Prevents outliers from dominating
     * If undefined, no capping is applied
     */
    maxVariance?: number;
}
/**
 * Computes local variance as texture detection preprocessing
 *
 * STANDALONE PREPROCESSING: This class only detects texture.
 * It does NOT perform edge detection.
 *
 * Input: ChannelImage (typically grayscale image)
 * Output: ChannelImage with same dimensions where each pixel value
 *         represents texture strength (0 = pure structure, 1 = pure texture)
 *
 * The output can be:
 * 1. Passed to your XDoG/FDoG/HDoG implementation to modulate parameters
 * 2. Combined with other texture detection methods (Spectral, Patch-based)
 * 3. Visualized for debugging
 * 4. Processed through additional preprocessing steps
 *
 * Example:
 * ```
 * const preprocessor = new LocalVariancePreprocessor({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 * });
 *
 * const textureMap = preprocessor.process(grayImage);
 * // textureMap.data[i] = texture strength at pixel i
 * // Now use textureMap with your own edge detection
 * ```
 */
declare class LocalVariancePreprocessor implements Preprocessor {
    private config;
    /** CPU-only — no WebGL/WebGPU counterpart exists for this preprocessor. */
    readonly backend: "cpu";
    constructor(config?: Partial<LocalVarianceConfig>);
    dispose(): void;
    /**
     * Compute texture strength map from image
     *
     * @param image Input grayscale image (Float32Array, 0-1 normalized)
     * @returns ChannelImage containing texture strength values
     *          Each pixel: 0 = pure structure (edges, boundaries)
     *                     1 = pure texture (patterns, fine details)
     *          Developer uses these values to adapt XDoG parameters
     */
    process(image: ChannelImage): Promise<ChannelImage>;
    /**
     * Compute variance of pixel values in a window
     * @private
     */
    private computeLocalVariance;
    /**
     * Compute gradient magnitude at pixel (Sobel filter)
     * Used to normalize variance (distinguish texture from edges)
     * @private
     */
    private computeLocalGradient;
}
/**
 * Optimized Local Variance Texture Detector
 *
 * Same functionality as LocalVariancePreprocessor, but faster.
 * Uses separable convolution: O(n x r) instead of O(n x r^2)
 *
 * Approach: Variance = E[X^2] - E[X]^2
 * - Compute box blur of image (gives E[X])
 * - Compute box blur of image squared (gives E[X^2])
 * - Subtract to get variance
 *
 * Performance:
 * - Basic version: ~1-2ms for 1080p (5x5 window)
 * - Optimized version: ~0.5ms for 1080p (5x5 window)
 * - 3-4x faster for large windows
 *
 * Use this for real-time applications. Basic version is fine for batch processing.
 */
declare class LocalVariancePreprocessorOptimized implements Preprocessor {
    private config;
    /** CPU-only — no WebGL/WebGPU counterpart exists for this preprocessor. */
    readonly backend: "cpu";
    constructor(config?: Partial<LocalVarianceConfig>);
    dispose(): void;
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X^2] - E[X]^2
     * Compute box blur of X and X^2 separately, then combine
     */
    process(image: ChannelImage): Promise<ChannelImage>;
    /**
     * Fast box blur using separable convolution + a sliding-window running sum.
     *
     * @remarks
     * Each pass is O(width * height): the window sum is updated incrementally
     * as it slides one pixel over (`sum += incoming - outgoing`) rather than
     * being re-summed from scratch at every position, so cost no longer grows
     * with `radius`. Edge pixels use clamp-to-edge boundary handling.
     *
     * Trade-off: because each sum is derived from the previous one instead of
     * being recomputed from scratch, floating-point error can accumulate along
     * a scan line, unlike the resum-per-pixel approach this replaces. This is
     * negligible in practice for 0-1 normalized pixel values and the small
     * radii (1-4) this preprocessor supports.
     *
     * @private
     */
    private boxBlur;
    /**
     * Compute gradient map using Sobel filter (separable for efficiency)
     * @private
     */
    private computeGradientMap;
}

/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" preprocessors.
 */

declare abstract class ResilientPreprocessor<TConfig> implements Preprocessor {
    private readonly candidates;
    private readonly config;
    private readonly failedBackends;
    private instance;
    private currentCtor;
    /**
     * Subclasses resolve their instance via `resolve()` *before* calling
     * this (in their own async static `create()`), then hand the result in
     * here. The constructor itself stays synchronous, as constructors must.
     */
    protected constructor(candidates: readonly PreprocessorCtor[], resolved: {
        instance: Preprocessor;
        ctor: PreprocessorCtor;
    }, config: TConfig);
    /**
     * Try each candidate in order, skipping unsupported ones. If a
     * candidate reports supported but throws on construction anyway
     * (isSupported() lied), move on to the next.
     */
    protected static resolve<TConfig>(candidates: readonly PreprocessorCtor[], config: TConfig): Promise<{
        instance: Preprocessor;
        ctor: PreprocessorCtor;
    }>;
    get backend(): "webgpu" | "webgl" | "cpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
    private demoteAndFindNext;
}

/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 */

declare class BilateralFilterWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<BilateralFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
declare class GaussianBlurWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly sigma;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(sigma?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
declare class MedianFilterWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<MedianFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
declare class KuwaharaFilterWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<KuwaharaFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
declare class ContrastEnhancerWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly blackPoint;
    private readonly whitePoint;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(blackPoint?: number, whitePoint?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
declare class QuantizerWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly levels;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(levels?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Check if WebGL 2.0 is available
 */
declare function isWebGLAvailable(): boolean;
/**
 * Cleanup all WebGL resources
 */
declare function disposeWebGL(): void;

type webgl_BilateralFilterWebGL = BilateralFilterWebGL;
declare const webgl_BilateralFilterWebGL: typeof BilateralFilterWebGL;
type webgl_ContrastEnhancerWebGL = ContrastEnhancerWebGL;
declare const webgl_ContrastEnhancerWebGL: typeof ContrastEnhancerWebGL;
type webgl_GaussianBlurWebGL = GaussianBlurWebGL;
declare const webgl_GaussianBlurWebGL: typeof GaussianBlurWebGL;
type webgl_KuwaharaFilterWebGL = KuwaharaFilterWebGL;
declare const webgl_KuwaharaFilterWebGL: typeof KuwaharaFilterWebGL;
type webgl_MedianFilterWebGL = MedianFilterWebGL;
declare const webgl_MedianFilterWebGL: typeof MedianFilterWebGL;
type webgl_QuantizerWebGL = QuantizerWebGL;
declare const webgl_QuantizerWebGL: typeof QuantizerWebGL;
declare const webgl_disposeWebGL: typeof disposeWebGL;
declare const webgl_isWebGLAvailable: typeof isWebGLAvailable;
declare namespace webgl {
  export {
    BilateralFilterWebGL as BilateralFilter,
    webgl_BilateralFilterWebGL as BilateralFilterWebGL,
    ContrastEnhancerWebGL as ContrastEnhancer,
    webgl_ContrastEnhancerWebGL as ContrastEnhancerWebGL,
    GaussianBlurWebGL as GaussianBlur,
    webgl_GaussianBlurWebGL as GaussianBlurWebGL,
    KuwaharaFilterWebGL as KuwaharaFilter,
    webgl_KuwaharaFilterWebGL as KuwaharaFilterWebGL,
    MedianFilterWebGL as MedianFilter,
    webgl_MedianFilterWebGL as MedianFilterWebGL,
    QuantizerWebGL as Quantizer,
    webgl_QuantizerWebGL as QuantizerWebGL,
    webgl_disposeWebGL as disposeWebGL,
    webgl_isWebGLAvailable as isWebGLAvailable,
  };
}

/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 *
 * Even faster than WebGL implementations
 */

/** Release the cached device. Mainly useful for tests / hot reload. */
declare function disposeWebGPU(): void;

/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class resolves its OWN best-supported
 * backend independently (WebGPU > WebGL > CPU), the first time it's
 * created:
 *
 *   BilateralFilter.create(...)  // may end up WebGPU on this device
 *   MedianFilter.create(...)     // may end up WebGL on this device, if
 *                                // e.g. it needs a storage texture format
 *                                // WebGPU can't provide here
 *
 * A device can support WebGPU for one algorithm and not another, so
 * resolution happens per class, not once globally for the whole module —
 * this follows the same pattern used for BlurStrategy/ETFComputer.
 *
 * If a backend fails mid-session (driver crash, lost context), each
 * instance demotes itself to the next supported candidate once and
 * retries the call that failed; that shared retry/demote machinery lives
 * in `ResilientPreprocessor`, not duplicated per filter.
 */

interface BackendOptions {
    /** Force CPU even if WebGL/WebGPU are available. Default: false. */
    forceCPU?: boolean;
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
declare class BilateralFilter extends ResilientPreprocessor<Partial<BilateralFilterConfig>> {
    private static readonly candidates;
    private constructor();
    static create(config?: Partial<BilateralFilterConfig>, options?: BackendOptions): Promise<BilateralFilter>;
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
declare class MedianFilter extends ResilientPreprocessor<Partial<MedianFilterConfig>> {
    private static readonly candidates;
    private constructor();
    static create(config?: Partial<MedianFilterConfig>, options?: BackendOptions): Promise<MedianFilter>;
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
declare class KuwaharaFilter extends ResilientPreprocessor<Partial<KuwaharaFilterConfig>> {
    private static readonly candidates;
    private constructor();
    static create(config?: Partial<KuwaharaFilterConfig>, options?: BackendOptions): Promise<KuwaharaFilter>;
}
/**
 * Separable Gaussian blur.
 *
 * Config here is just `number` (sigma), not an object — candidates'
 * constructors all take `(sigma: number)` directly, so `TConfig` is
 * `number` rather than a `Partial<...>` shape.
 */
declare class GaussianBlur extends ResilientPreprocessor<number> {
    private static readonly candidates;
    private constructor();
    static create(sigma?: number, options?: BackendOptions): Promise<GaussianBlur>;
}
interface ContrastPoints {
    blackPoint: number;
    whitePoint: number;
}
declare class ContrastEnhancer extends ResilientPreprocessor<ContrastPoints> {
    private static readonly candidates;
    private constructor();
    static create(blackPoint?: number, whitePoint?: number, options?: BackendOptions): Promise<ContrastEnhancer>;
}
/**
 * Posterize/quantize intensity levels.
 */
declare class Quantizer extends ResilientPreprocessor<number> {
    private static readonly candidates;
    private constructor();
    static create(levels?: number, options?: BackendOptions): Promise<Quantizer>;
}
declare const PreprocessingPresets: {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input: ChannelImage) => Promise<ChannelImage>;
};
declare class PreprocessingPipeline {
    private readonly options?;
    private operations;
    constructor(options?: BackendOptions | undefined);
    bilateral(config?: Partial<BilateralFilterConfig>): Promise<this>;
    median(config?: Partial<MedianFilterConfig>): Promise<this>;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): Promise<this>;
    gaussian(sigma?: number): Promise<this>;
    contrast(blackPoint?: number, whitePoint?: number): Promise<this>;
    quantize(levels?: number): Promise<this>;
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline.
     * Bring your own backend selection if needed.
     */
    use(preprocessor: Preprocessor): this;
    apply(input: ChannelImage): Promise<ChannelImage>;
    /** Disposes every staged operation's resources and clears the pipeline. */
    clear(): this;
}

type index$2_BackendOptions = BackendOptions;
type index$2_BilateralFilter = BilateralFilter;
declare const index$2_BilateralFilter: typeof BilateralFilter;
type index$2_ContrastEnhancer = ContrastEnhancer;
declare const index$2_ContrastEnhancer: typeof ContrastEnhancer;
type index$2_GaussianBlur = GaussianBlur;
declare const index$2_GaussianBlur: typeof GaussianBlur;
type index$2_KuwaharaFilter = KuwaharaFilter;
declare const index$2_KuwaharaFilter: typeof KuwaharaFilter;
type index$2_LocalVarianceConfig = LocalVarianceConfig;
type index$2_LocalVariancePreprocessor = LocalVariancePreprocessor;
declare const index$2_LocalVariancePreprocessor: typeof LocalVariancePreprocessor;
type index$2_LocalVariancePreprocessorOptimized = LocalVariancePreprocessorOptimized;
declare const index$2_LocalVariancePreprocessorOptimized: typeof LocalVariancePreprocessorOptimized;
type index$2_MedianFilter = MedianFilter;
declare const index$2_MedianFilter: typeof MedianFilter;
type index$2_PreprocessingPipeline = PreprocessingPipeline;
declare const index$2_PreprocessingPipeline: typeof PreprocessingPipeline;
declare const index$2_PreprocessingPresets: typeof PreprocessingPresets;
type index$2_Quantizer = Quantizer;
declare const index$2_Quantizer: typeof Quantizer;
declare const index$2_disposeWebGL: typeof disposeWebGL;
declare const index$2_disposeWebGPU: typeof disposeWebGPU;
declare const index$2_isWebGLAvailable: typeof isWebGLAvailable;
declare const index$2_webgl: typeof webgl;
declare namespace index$2 {
  export { index$2_BilateralFilter as BilateralFilter, index$2_ContrastEnhancer as ContrastEnhancer, index$2_GaussianBlur as GaussianBlur, index$2_KuwaharaFilter as KuwaharaFilter, index$2_LocalVariancePreprocessor as LocalVariancePreprocessor, index$2_LocalVariancePreprocessorOptimized as LocalVariancePreprocessorOptimized, index$2_MedianFilter as MedianFilter, index$2_PreprocessingPipeline as PreprocessingPipeline, index$2_PreprocessingPresets as PreprocessingPresets, index$2_Quantizer as Quantizer, index$2_disposeWebGL as disposeWebGL, index$2_disposeWebGPU as disposeWebGPU, index$2_isWebGLAvailable as isWebGLAvailable, index$2_webgl as webgl };
  export type { index$2_BackendOptions as BackendOptions, index$2_LocalVarianceConfig as LocalVarianceConfig };
}

/**
 * Color space conversion utilities
 *
 * Responsible for turning an RGBImage into a set of independent
 * ChannelImage instances, either as raw RGB channels or as CIE Lab
 * channels (L, a, b). Kept separate from the ETF/structure-tensor math
 * so that flow.ts stays focused purely on the Di Zenzo / eigen-decomposition
 * pipeline and doesn't need to know anything about color science.
 */

/**
 * Which color space to decompose an RGBImage into before computing
 * a multi-channel Edge Tangent Flow.
 */
type ColorSpace = 'rgb' | 'lab';
/**
 * Split an interleaved RGBImage into three independent ChannelImages,
 * one per channel, each still in 0-1 range.
 */
declare function splitRGBChannels(rgb: RGBImage$1): [ChannelImage, ChannelImage, ChannelImage];
/**
 * Convert an interleaved RGBImage into three independent ChannelImages
 * representing CIE Lab's L, a, and b components.
 *
 * L is normalized from its native [0, 100] range to [0, 1] by dividing by 100.
 * a and b are normalized from their native (roughly [-128, 127]) range to
 * [0, 1] via (v + 128) / 255.
 *
 * This normalization is a deliberate choice: it keeps all three channels in
 * comparable numeric ranges before gradients/tensors are computed, so that
 * chroma channels don't dominate or get drowned out purely due to differing
 * native scales relative to L. Input RGB is assumed to be sRGB with values
 * in [0, 1].
 */
declare function rgbToLabChannels(rgb: RGBImage$1): [ChannelImage, ChannelImage, ChannelImage];
/**
 * Convert a single sRGB pixel (each component in [0, 1]) to CIE Lab
 * (D65 white point). L is in [0, 100]; a and b are roughly in [-128, 127]
 * but are not hard-clamped.
 */
declare function srgbToLab(r: number, g: number, b: number): [number, number, number];

type color_ColorSpace = ColorSpace;
declare const color_rgbToLabChannels: typeof rgbToLabChannels;
declare const color_splitRGBChannels: typeof splitRGBChannels;
declare const color_srgbToLab: typeof srgbToLab;
declare namespace color {
  export { color_rgbToLabChannels as rgbToLabChannels, color_splitRGBChannels as splitRGBChannels, color_srgbToLab as srgbToLab };
  export type { color_ColorSpace as ColorSpace };
}

/**
 * Image utility functions
 */

/**
 * Create a new grayscale image with given dimensions
 */
declare function createChannelImage(width: number, height: number): ChannelImage;
/**
 * Clone a grayscale image
 */
declare function cloneChannelImage(image: ChannelImage): ChannelImage;
/**
 * Get pixel value with bounds checking (clamps to edge)
 */
declare function getPixel(image: ChannelImage, x: number, y: number): number;
/**
 * Get pixel value with bilinear interpolation for sub-pixel sampling
 */
declare function getPixelBilinear(image: ChannelImage, x: number, y: number): number;
/**
 * Set pixel value
 */
declare function setPixel(image: ChannelImage, x: number, y: number, value: number): void;
/**
 * Get pixel index for coordinates
 */
declare function getIndex(width: number, x: number, y: number): number;
/**
 * Convert RGB image to grayscale using luminance formula
 */
declare function rgbToGrayscale(rgb: RGBImage$1): ChannelImage;
/**
 * Convert ImageData (from canvas) to grayscale image
 * Assumes values are in 0-255 range, normalizes to 0-1
 */
declare function imageDataToLuminance(imageData: ImageData): ChannelImage;
/**
 * Convert grayscale image to ImageData (for canvas display)
 * Assumes input is in 0-1 range
 *
 * @param alpha Optional per-pixel alpha (0-255), one entry per pixel in
 * the same row-major order as `gray.data`. Omit to get a fully opaque
 * image (alpha = 255 everywhere), which matches this function's original
 * behavior for callers that don't care about transparency.
 */
declare function luminanceToImageData(gray: ChannelImage, alpha?: Uint8ClampedArray): ImageData;
/**
 * Normalize a 2D vector
 */
declare function normalizeVec2(v: Vec2): Vec2;
/**
 * Compute dot product of two vectors
 */
declare function dotVec2(a: Vec2, b: Vec2): number;
/**
 * Rotate vector 90 degrees counter-clockwise (perpendicular)
 */
declare function perpendicular(v: Vec2): Vec2;
/**
 * Generate 1D Gaussian kernel
 * @param sigma Standard deviation
 * @param size Kernel size (should be odd)
 * @returns Normalized Gaussian kernel
 */
declare function generateGaussianKernel(sigma: number, size: number): Float32Array;
/**
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2× sigma for flow-aligned,
 * and extends to 2.45σ for structure tensor blur
 *
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3σ on each side)
 */
declare function computeKernelSize(sigma: number, multiplier?: number): number;
/**
 * Clamp a value to a range
 */
declare function clamp(value: number, min: number, max: number): number;
/**
 * Linear interpolation
 */
declare function lerp(a: number, b: number, t: number): number;
/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
declare function at(value: number | ChannelImage, i: number): number;
/**
 * Sample a single value from a standard normal distribution N(0, 1)
 * using the Box-Muller transform.
 *
 * Used by ADoG's adaptive noise injection (Eq. 6): the sampled value is
 * scaled by a tone-dependent sigma(x) and added to the input luminance.
 */
declare function gaussianSample(): number;
/**
 * Pixel-wise logical AND across N binarized (0/1) ChannelImages.
 *
 * Generalizes Eq. (7)/(9) from "Gaussian Image Binarization":
 *   HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
 *
 * Since binarized images only contain 0 or 1, logical AND is equivalent to
 * taking the minimum across images (no De Morgan's / inversion needed here
 * -- see the paper's Eq. (8) for why AND and "invert-OR-invert" coincide;
 * this just implements AND directly).
 *
 * All images must have matching dimensions; this is not checked here for
 * performance -- validate upstream if inputs could mismatch.
 */
declare function andCombine(images: ChannelImage[]): ChannelImage;
declare function isWebGLComputeSupported(): boolean;
declare function isWebGPUSupported(): Promise<boolean>;

declare const index$1_andCombine: typeof andCombine;
declare const index$1_at: typeof at;
declare const index$1_clamp: typeof clamp;
declare const index$1_cloneChannelImage: typeof cloneChannelImage;
declare const index$1_color: typeof color;
declare const index$1_computeKernelSize: typeof computeKernelSize;
declare const index$1_createChannelImage: typeof createChannelImage;
declare const index$1_dotVec2: typeof dotVec2;
declare const index$1_gaussianSample: typeof gaussianSample;
declare const index$1_generateGaussianKernel: typeof generateGaussianKernel;
declare const index$1_getIndex: typeof getIndex;
declare const index$1_getPixel: typeof getPixel;
declare const index$1_getPixelBilinear: typeof getPixelBilinear;
declare const index$1_imageDataToLuminance: typeof imageDataToLuminance;
declare const index$1_isWebGLComputeSupported: typeof isWebGLComputeSupported;
declare const index$1_isWebGPUSupported: typeof isWebGPUSupported;
declare const index$1_lerp: typeof lerp;
declare const index$1_luminanceToImageData: typeof luminanceToImageData;
declare const index$1_normalizeVec2: typeof normalizeVec2;
declare const index$1_perpendicular: typeof perpendicular;
declare const index$1_rgbToGrayscale: typeof rgbToGrayscale;
declare const index$1_setPixel: typeof setPixel;
declare namespace index$1 {
  export {
    index$1_andCombine as andCombine,
    index$1_at as at,
    index$1_clamp as clamp,
    index$1_cloneChannelImage as cloneChannelImage,
    index$1_color as color,
    index$1_computeKernelSize as computeKernelSize,
    index$1_createChannelImage as createChannelImage,
    index$1_dotVec2 as dotVec2,
    index$1_gaussianSample as gaussianSample,
    index$1_generateGaussianKernel as generateGaussianKernel,
    index$1_getIndex as getIndex,
    index$1_getPixel as getPixel,
    index$1_getPixelBilinear as getPixelBilinear,
    index$1_imageDataToLuminance as imageDataToLuminance,
    index$1_isWebGLComputeSupported as isWebGLComputeSupported,
    index$1_isWebGPUSupported as isWebGPUSupported,
    index$1_lerp as lerp,
    index$1_luminanceToImageData as luminanceToImageData,
    index$1_normalizeVec2 as normalizeVec2,
    index$1_perpendicular as perpendicular,
    index$1_rgbToGrayscale as rgbToGrayscale,
    index$1_setPixel as setPixel,
  };
}

/**
 * Base interface for all extension strategies
 */
interface ExtensionStrategy<TConfig, TInput, TOutput> {
    apply(input: TInput, config?: Partial<TConfig>): Promise<TOutput>;
}
/**
 * RGB image representation for color operations
 */
interface RGBImage {
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
    width: number;
    height: number;
}
/**
 * Result from a DoG processor (either XDoG or FDoG)
 */
interface DoGResult {
    /** The final processed image */
    image: ChannelImage;
    /** The sharpened image before thresholding (if available) */
    sharpened?: ChannelImage;
    /** Edge tangent flow (only from FDoG) */
    etf?: FlowField;
    /** The original grayscale input */
    originalGray?: ChannelImage;
    /** The original color input (if provided) */
    originalColor?: RGBImage;
}

/**
 * Anti-aliasing configuration
 *
 * From Section 4.3: "Since many of the examples in this paper use the ETF
 * field to compute coherent edges, we can easily re-use the ETF to apply
 * a very small line integral convolution along the field"
 */
interface AntiAliasingConfig {
    /**
     * Integration sigma along the flow direction (default: 1.0)
     * - 0.5-2 pixels: Standard anti-aliasing
     * - >2: Stylistic smoothing effect
     */
    sigma: number;
    /**
     * Step size for LIC sampling (default: 0.5)
     */
    stepSize: number;
}
/**
 * Anti-Aliasing Strategy
 *
 * Applies line integral convolution along the edge tangent flow
 * to produce image-coherent and visually pleasing anti-aliasing.
 *
 * @example
 * ```typescript
 * const fdog = new FDoG({ ... });
 * const result = await fdog.processDetailed(input);
 *
 * const aa = new AntiAliasingStrategy();
 * const smoothed = await aa.apply({
 *   image: result.result,
 *   etf: result.etf
 * }, { sigma: 1.5 });
 * ```
 */
declare class AntiAliasingStrategy implements ExtensionStrategy<AntiAliasingConfig, {
    image: ChannelImage;
    etf: FlowField;
}, ChannelImage> {
    private config;
    constructor(config?: Partial<AntiAliasingConfig>);
    apply(input: {
        image: ChannelImage;
        etf: FlowField;
    }, configOverride?: Partial<AntiAliasingConfig>): Promise<ChannelImage>;
    /**
     * Create anti-aliasing with preset intensity
     */
    static withPreset(preset: 'subtle' | 'standard' | 'stylistic'): AntiAliasingStrategy;
}

/**
 * Color Retention Extension - Extensible Architecture
 *
 * Provides a composable, hook-based system for combining stylized XDoG/FDoG
 * output with original colors. Developers can inject custom logic at every
 * stage of the pipeline.
 *
 * Pipeline stages:
 * 1. Mask Transform: Modify the stylized mask before blending
 * 2. Color Transform: Pre-process the original color
 * 3. Blend Function: Combine mask and color (the core operation)
 * 4. Post-Process: Final adjustments to the output
 *
 * Based on Section 5.2 of the XDoG paper.
 */

/**
 * RGBA color tuple (values in 0-1 range)
 */
type Color = [r: number, g: number, b: number];
/**
 * Pixel context provided to all hook functions
 * Contains spatial and neighborhood information for advanced effects
 */
interface PixelContext {
    /** Current pixel x coordinate */
    x: number;
    /** Current pixel y coordinate */
    y: number;
    /** Linear index into the image array */
    index: number;
    /** Image width */
    width: number;
    /** Image height */
    height: number;
    /** Normalized x coordinate (0-1) */
    u: number;
    /** Normalized v coordinate (0-1) */
    v: number;
    /**
     * Sample the original color at an offset from current pixel
     * Useful for blur, sharpen, or texture effects
     */
    sampleColor: (dx: number, dy: number) => Color;
    /**
     * Sample the mask at an offset from current pixel
     */
    sampleMask: (dx: number, dy: number) => number;
    /**
     * Get a value from the shared state (for multi-pass effects)
     */
    getState: <T>(key: string) => T | undefined;
    /**
     * Set a value in the shared state
     */
    setState: <T>(key: string, value: T) => void;
}
/**
 * Transform the stylized mask value before blending
 *
 * @param mask - Original mask value (0 = edge, 1 = background)
 * @param ctx - Pixel context with spatial info and sampling functions
 * @returns Transformed mask value
 *
 * @example
 * ```typescript
 * // Increase edge thickness by expanding dark regions
 * const thickenEdges: MaskTransformFn = (mask, ctx) => {
 *   // Sample neighbors and take minimum (expand dark)
 *   let min = mask;
 *   for (let dy = -1; dy <= 1; dy++) {
 *     for (let dx = -1; dx <= 1; dx++) {
 *       min = Math.min(min, ctx.sampleMask(dx, dy));
 *     }
 *   }
 *   return min;
 * };
 * ```
 */
type MaskTransformFn = (mask: number, ctx: PixelContext) => number;
/**
 * Transform the original color before blending
 *
 * @param color - Original RGB color
 * @param mask - Current mask value (after mask transform)
 * @param ctx - Pixel context
 * @returns Transformed color
 *
 * @example
 * ```typescript
 * // Boost saturation in non-edge areas
 * const boostSaturation: ColorTransformFn = (color, mask, ctx) => {
 *   const [h, s, l] = rgbToHsl(...color);
 *   const boostedS = s * (1 + 0.3 * mask); // More saturation where mask is light
 *   return hslToRgb(h, Math.min(1, boostedS), l);
 * };
 * ```
 */
type ColorTransformFn = (color: Color, mask: number, ctx: PixelContext) => Color;
/**
 * Core blend function that combines mask and color
 *
 * @param color - Transformed color
 * @param mask - Transformed mask value
 * @param ctx - Pixel context
 * @returns Blended output color
 *
 * @example
 * ```typescript
 * // Simple multiply blend
 * const multiply: BlendFn = (color, mask) => {
 *   return [color[0] * mask, color[1] * mask, color[2] * mask];
 * };
 *
 * // Screen blend for lighter result
 * const screen: BlendFn = (color, mask) => {
 *   return [
 *     1 - (1 - color[0]) * (1 - mask),
 *     1 - (1 - color[1]) * (1 - mask),
 *     1 - (1 - color[2]) * (1 - mask),
 *   ];
 * };
 * ```
 */
type BlendFn = (color: Color, mask: number, ctx: PixelContext) => Color;
/**
 * Post-process the blended result
 *
 * @param color - Blended color
 * @param originalColor - Original input color (for reference)
 * @param mask - Final mask value
 * @param ctx - Pixel context
 * @returns Final output color
 *
 * @example
 * ```typescript
 * // Add vignette effect
 * const vignette: PostProcessFn = (color, original, mask, ctx) => {
 *   const dist = Math.sqrt((ctx.u - 0.5) ** 2 + (ctx.v - 0.5) ** 2);
 *   const vignette = 1 - Math.min(1, dist * 1.2);
 *   return [color[0] * vignette, color[1] * vignette, color[2] * vignette];
 * };
 * ```
 */
type PostProcessFn = (color: Color, originalColor: Color, mask: number, ctx: PixelContext) => Color;
/**
 * Global pre-processing hook (runs once before pixel iteration)
 * Useful for computing histograms, statistics, or initializing state
 */
type PreProcessHook = (stylized: ChannelImage, originalColor: RGBImage, state: Map<string, unknown>) => void;
/**
 * Global post-processing hook (runs once after pixel iteration)
 * Useful for normalization, filtering, or multi-pass effects
 */
type GlobalPostProcessHook = (output: RGBImage, state: Map<string, unknown>) => RGBImage;
/**
 * Full configuration for the color retention pipeline
 */
interface ColorRetentionConfig {
    /**
     * Mask transformation function
     * Default: identity (no change)
     */
    maskTransform?: MaskTransformFn;
    /**
     * Color transformation function
     * Default: identity (no change)
     */
    colorTransform?: ColorTransformFn;
    /**
     * Core blend function (required or use preset)
     */
    blend: BlendFn;
    /**
     * Post-processing function
     * Default: identity (no change)
     */
    postProcess?: PostProcessFn;
    /**
     * Global pre-processing hook
     */
    preProcess?: PreProcessHook;
    /**
     * Global post-processing hook
     */
    globalPostProcess?: GlobalPostProcessHook;
    /**
     * Chain multiple mask transforms (applied in order)
     */
    maskTransformChain?: MaskTransformFn[];
    /**
     * Chain multiple color transforms (applied in order)
     */
    colorTransformChain?: ColorTransformFn[];
    /**
     * Chain multiple post-process functions (applied in order)
     */
    postProcessChain?: PostProcessFn[];
}
/**
 * Extensible Color Retention Strategy
 *
 * A fully customizable pipeline for combining stylized edges with colors.
 * Every stage can be overridden with custom functions.
 *
 * @example Basic usage with preset
 * ```typescript
 * const strategy = ColorRetentionStrategy.preset('coloredEdges');
 * const result = await strategy.apply({ stylized, originalColor });
 * ```
 *
 * @example Custom blend function
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   blend: (color, mask) => {
 *     // Custom logic here
 *     return [color[0] * mask, color[1] * mask, color[2] * mask];
 *   }
 * });
 * ```
 *
 * @example Full pipeline customization
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransform: (mask) => Math.pow(mask, 0.8), // Gamma adjust
 *   colorTransform: (color, mask) => boostSaturation(color, 1.2),
 *   blend: BlendFunctions.multiply,
 *   postProcess: (color, orig, mask, ctx) => addVignette(color, ctx),
 * });
 * ```
 *
 * @example Chaining multiple transforms
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransformChain: [
 *     MaskTransforms.gamma(0.8),
 *     MaskTransforms.threshold(0.1, 0.9),
 *   ],
 *   colorTransformChain: [
 *     ColorTransforms.saturation(1.2),
 *     ColorTransforms.brightness(0.1),
 *   ],
 *   blend: BlendFunctions.coloredEdges(),
 * });
 * ```
 */
declare class ColorRetentionStrategy {
    private config;
    constructor(config: ColorRetentionConfig);
    apply(input: {
        stylized: ChannelImage;
        originalColor: RGBImage;
    }, configOverride?: Partial<ColorRetentionConfig>): Promise<RGBImage>;
    private buildMaskTransformChain;
    private buildColorTransformChain;
    private buildPostProcessChain;
    private createPixelContext;
    /**
     * Create a strategy from a preset
     */
    static preset(name: keyof typeof Presets): ColorRetentionStrategy;
    /**
     * Create a strategy with just a blend function
     */
    static withBlend(blend: BlendFn): ColorRetentionStrategy;
    /**
     * Builder pattern for constructing complex pipelines
     */
    static builder(): ColorRetentionBuilder;
}
/**
 * Fluent builder for constructing color retention pipelines
 *
 * @example
 * ```typescript
 * const strategy = ColorRetentionStrategy.builder()
 *   .maskTransform(MaskTransforms.gamma(0.8))
 *   .maskTransform(MaskTransforms.clamp(0.05, 0.95))
 *   .colorTransform(ColorTransforms.saturation(1.2))
 *   .blend(BlendFunctions.multiply)
 *   .postProcess(PostProcessors.vignette(0.3))
 *   .build();
 * ```
 */
declare class ColorRetentionBuilder {
    private maskTransforms;
    private colorTransforms;
    private postProcesses;
    private blendFn?;
    private preProcessHook?;
    private globalPostProcessHook?;
    maskTransform(fn: MaskTransformFn): this;
    colorTransform(fn: ColorTransformFn): this;
    blend(fn: BlendFn): this;
    postProcess(fn: PostProcessFn): this;
    preProcess(fn: PreProcessHook): this;
    globalPostProcess(fn: GlobalPostProcessHook): this;
    build(): ColorRetentionStrategy;
}
/**
 * Collection of common blend functions
 */
declare const BlendFunctions$1: {
    /**
     * Simple multiply: color * mask
     * White mask = full color, black mask = black
     */
    multiply: BlendFn;
    /**
     * Screen blend: 1 - (1-color) * (1-mask)
     * Creates lighter results
     */
    screen: BlendFn;
    /**
     * Overlay blend: combines multiply and screen
     */
    overlay: BlendFn;
    /**
     * Soft light blend: gentler than overlay
     */
    softLight: BlendFn;
    /**
     * Colored edges: black lines on colored background
     * Most common use case for line art + color
     */
    coloredEdges: (edgeStrength?: number) => BlendFn;
    /**
     * Tinted lines: edges take on underlying color
     */
    tintedLines: (darkness?: number) => BlendFn;
    /**
     * Luminosity replacement in HSL space
     */
    luminosity: BlendFn;
    /**
     * Linear interpolation between color and grayscale edge
     */
    lerp: (edgeColor?: Color) => BlendFn;
    /**
     * Preserve hue and saturation, replace value (HSV)
     */
    valueReplace: BlendFn;
};
/**
 * Collection of mask transformation functions
 */
declare const MaskTransforms: {
    /**
     * Gamma correction for mask
     */
    gamma: (gamma: number) => MaskTransformFn;
    /**
     * Clamp mask to range
     */
    clamp: (min: number, max: number) => MaskTransformFn;
    /**
     * Remap mask from [inMin, inMax] to [outMin, outMax]
     */
    remap: (inMin: number, inMax: number, outMin?: number, outMax?: number) => MaskTransformFn;
    /**
     * Invert the mask
     */
    invert: () => MaskTransformFn;
    /**
     * Apply contrast adjustment
     */
    contrast: (amount: number) => MaskTransformFn;
    /**
     * Threshold with soft edges
     */
    softThreshold: (threshold: number, softness?: number) => MaskTransformFn;
    /**
     * Hard threshold (binary)
     */
    threshold: (threshold: number) => MaskTransformFn;
    /**
     * Quantize to N levels
     */
    quantize: (levels: number) => MaskTransformFn;
    /**
     * Morphological dilation (expand dark/edge regions)
     */
    dilate: (radius?: number) => MaskTransformFn;
    /**
     * Morphological erosion (shrink dark/edge regions)
     */
    erode: (radius?: number) => MaskTransformFn;
    /**
     * Gaussian blur approximation
     */
    blur: (radius?: number) => MaskTransformFn;
    /**
     * Add noise to mask
     */
    noise: (amount: number, seed?: number) => MaskTransformFn;
};
/**
 * Collection of color transformation functions
 */
declare const ColorTransforms: {
    /**
     * Adjust saturation
     */
    saturation: (factor: number) => ColorTransformFn;
    /**
     * Adjust brightness
     */
    brightness: (amount: number) => ColorTransformFn;
    /**
     * Adjust contrast
     */
    contrast: (amount: number) => ColorTransformFn;
    /**
     * Shift hue
     */
    hueShift: (degrees: number) => ColorTransformFn;
    /**
     * Desaturate based on mask (less saturation in edge areas)
     */
    maskBasedDesaturate: (factor?: number) => ColorTransformFn;
    /**
     * Apply a color matrix transformation
     */
    colorMatrix: (matrix: number[][]) => ColorTransformFn;
    /**
     * Sepia tone
     */
    sepia: (intensity?: number) => ColorTransformFn;
    /**
     * Warm/cool temperature adjustment
     */
    temperature: (warmth: number) => ColorTransformFn;
};
/**
 * Collection of post-processing functions
 */
declare const PostProcessors: {
    /**
     * Add vignette effect
     */
    vignette: (strength?: number, radius?: number) => PostProcessFn;
    /**
     * Add film grain
     */
    grain: (amount?: number, seed?: number) => PostProcessFn;
    /**
     * Blend with original color
     */
    blendOriginal: (amount: number) => PostProcessFn;
    /**
     * Clamp output to valid range
     */
    clampOutput: () => PostProcessFn;
    /**
     * Posterize (reduce color levels)
     */
    posterize: (levels: number) => PostProcessFn;
    /**
     * Edge-aware sharpening
     */
    sharpenEdges: (amount?: number) => PostProcessFn;
};
/**
 * Pre-built configurations for common use cases
 */
declare const Presets: Record<string, ColorRetentionConfig>;
declare function imageDataToRGB$1(imageData: ImageData): RGBImage;
declare function rgbToImageData$1(rgb: RGBImage): ImageData;

type colorRetention_BlendFn = BlendFn;
type colorRetention_Color = Color;
type colorRetention_ColorRetentionBuilder = ColorRetentionBuilder;
declare const colorRetention_ColorRetentionBuilder: typeof ColorRetentionBuilder;
type colorRetention_ColorRetentionConfig = ColorRetentionConfig;
type colorRetention_ColorRetentionStrategy = ColorRetentionStrategy;
declare const colorRetention_ColorRetentionStrategy: typeof ColorRetentionStrategy;
type colorRetention_ColorTransformFn = ColorTransformFn;
declare const colorRetention_ColorTransforms: typeof ColorTransforms;
type colorRetention_GlobalPostProcessHook = GlobalPostProcessHook;
type colorRetention_MaskTransformFn = MaskTransformFn;
declare const colorRetention_MaskTransforms: typeof MaskTransforms;
type colorRetention_PixelContext = PixelContext;
type colorRetention_PostProcessFn = PostProcessFn;
declare const colorRetention_PostProcessors: typeof PostProcessors;
type colorRetention_PreProcessHook = PreProcessHook;
declare const colorRetention_Presets: typeof Presets;
declare namespace colorRetention {
  export { BlendFunctions$1 as BlendFunctions, colorRetention_ColorRetentionBuilder as ColorRetentionBuilder, colorRetention_ColorRetentionStrategy as ColorRetentionStrategy, colorRetention_ColorTransforms as ColorTransforms, colorRetention_MaskTransforms as MaskTransforms, colorRetention_PostProcessors as PostProcessors, colorRetention_Presets as Presets, imageDataToRGB$1 as imageDataToRGB, rgbToImageData$1 as rgbToImageData };
  export type { colorRetention_BlendFn as BlendFn, colorRetention_Color as Color, colorRetention_ColorRetentionConfig as ColorRetentionConfig, colorRetention_ColorTransformFn as ColorTransformFn, colorRetention_GlobalPostProcessHook as GlobalPostProcessHook, colorRetention_MaskTransformFn as MaskTransformFn, colorRetention_PixelContext as PixelContext, colorRetention_PostProcessFn as PostProcessFn, colorRetention_PreProcessHook as PreProcessHook };
}

/**
 * Hatching texture specification
 */
interface HatchTexture {
    /** Grayscale texture data (tiled as needed) */
    data: ChannelImage;
    /** Rotation angle in radians (0 = horizontal) */
    rotation: number;
}
/**
 * Hatching configuration
 *
 * From Section 5.1: "Our hatching approach is based on the concept of
 * tonal art maps, where layers of strokes add up to achieve a desired tone"
 */
interface HatchingConfig {
    /**
     * Threshold levels for creating masks (ascending order)
     * Each level creates a separate tone band
     * Default: [0.3, 0.5, 0.7] creates 4 bands
     */
    thresholdLevels: number[];
    /**
     * Hatching textures for each band (darkest to lightest)
     * Should have length = thresholdLevels.length + 1
     */
    textures?: HatchTexture[];
    /**
     * Background/paper texture (optional)
     */
    paperTexture?: ChannelImage;
    /**
     * Sharpening strength for threshold masks (default: 20)
     */
    p: number;
    /**
     * Smoothness of threshold transitions (default: 10)
     * Lower values = softer transitions between bands
     * Higher values = sharper band boundaries
     */
    phi: number;
    /**
     * Whether to use cumulative (tonal art map) style (default: true)
     * When true: darker areas accumulate more hatching layers
     * When false: each band is independent
     */
    cumulative: boolean;
}
/**
 * Hatching Strategy
 *
 * Creates tonal art maps by computing multiple threshold levels from a
 * sharpened XDoG/FDoG image and using them as masks for hatching textures.
 *
 * The key insight from tonal art maps is that darker tones are achieved by
 * ACCUMULATING hatching layers - dark areas have all hatching layers active,
 * while light areas have none.
 *
 * @example
 * ```typescript
 * const xdog = new XDoG({ p: 20 });
 * const { sharpened } = await xdog.processDetailed(input);
 *
 * const hatching = new HatchingStrategy({
 *   thresholdLevels: [0.25, 0.5, 0.75],
 *   textures: [darkHatch, medHatch, lightHatch, white],
 * });
 * const result = await hatching.apply({ sharpened, original: input });
 * ```
 */
declare class HatchingStrategy implements ExtensionStrategy<HatchingConfig, {
    sharpened: ChannelImage;
    original?: ChannelImage;
}, ChannelImage> {
    private config;
    constructor(config?: Partial<HatchingConfig>);
    /**
     * Generate cumulative threshold masks for tonal art maps
     *
     * For tonal art maps, we generate masks where:
     * - Mask 0 (darkest hatching): active where input < levels[0]
     * - Mask 1: active where input < levels[1]
     * - Mask N (lightest): active everywhere (or where input < 1.0)
     *
     * Each darker mask is a SUBSET of the lighter masks, creating the
     * cumulative effect where dark areas have more hatching.
     */
    generateMasks(sharpened: ChannelImage, configOverride?: Partial<HatchingConfig>): ChannelImage[];
    apply(input: {
        sharpened: ChannelImage;
        original?: ChannelImage;
    }, configOverride?: Partial<HatchingConfig>): Promise<ChannelImage>;
    /**
     * Sample a texture with tiling and rotation
     */
    private sampleTexture;
    /**
     * Generate a simple procedural hatching texture
     *
     * Creates parallel lines at the specified spacing and thickness.
     * The rotation parameter rotates the SAMPLING, not the line pattern itself.
     */
    static generateHatchTexture(width: number, height: number, spacing: number, thickness: number, rotation?: number): HatchTexture;
    /**
     * Generate a cross-hatching texture (two overlapping line patterns)
     */
    static generateCrossHatchTexture(width: number, height: number, spacing: number, thickness: number, angle1?: number, angle2?: number): HatchTexture;
}

/**
 * Natural media style presets
 */
type NaturalMediaStyle = 'pencilShading' | 'pastel' | 'charcoal' | 'dryBrush';
/**
 * Natural media configuration
 *
 * From Section 5.2: Parameters for various natural media looks
 */
interface NaturalMediaConfig {
    /** Base style preset */
    style: NaturalMediaStyle;
    /** Override sigma for edge detection */
    sigma?: number;
    /** Override p for edge emphasis */
    p?: number;
    /** Override phi for threshold sharpness */
    phi?: number;
    /** Override epsilon for threshold level */
    epsilon?: number;
    /** For FDoG: structure tensor smoothing */
    sigmaC?: number;
    /** For FDoG: flow-aligned smoothing */
    sigmaM?: number;
    /** For FDoG: anti-aliasing */
    sigmaA?: number;
    /** Use flow-based processing (FDoG) */
    useFlow?: boolean;
}
/**
 * Natural Media Strategy
 *
 * Provides preset parameter configurations for pencil, pastel, charcoal,
 * and other natural media styles as described in Section 5.2.
 *
 * @example
 * ```typescript
 * const naturalMedia = new NaturalMediaStrategy({ style: 'pastel' });
 * const result = await naturalMedia.apply(input);
 * ```
 */
declare class NaturalMediaStrategy implements ExtensionStrategy<NaturalMediaConfig, ChannelImage, ChannelImage> {
    private config;
    /**
     * Style presets from Section 5.2 and Table A.1
     *
     * Note on epsilon values:
     * - epsilon is the threshold for white vs black transition (0-1 range)
     * - Values ABOVE epsilon become white, values BELOW follow soft threshold
     * - For natural media effects, we want lower epsilon values to preserve
     *   more tonal variation and avoid all-white output
     */
    static readonly PRESETS: Record<NaturalMediaStyle, Partial<FDoGConfig> & {
        useFlow: boolean;
    }>;
    constructor(config?: Partial<NaturalMediaConfig>);
    /**
     * Get the resolved configuration for the current style
     */
    getResolvedConfig(): Partial<FDoGConfig> & {
        useFlow: boolean;
    };
    apply(input: ChannelImage, configOverride?: Partial<NaturalMediaConfig>): Promise<ChannelImage>;
    /**
     * Create strategy for a specific style
     */
    static forStyle(style: NaturalMediaStyle): NaturalMediaStrategy;
}

/**
 * Multi-Scale Strategy Types and Implementation
 *
 * Refactored to use function-based blending, allowing users to either:
 * 1. Use the provided blend functions (average, min, max, multiply)
 * 2. Supply their own custom blend function
 */

/**
 * Context provided to blend functions for each pixel
 */
interface BlendContext {
    /** Pixel values from each layer at the current position */
    values: number[];
    /** Normalized weights for each layer (sum to 1.0) */
    weights: number[];
    /** Current pixel x coordinate */
    x: number;
    /** Current pixel y coordinate */
    y: number;
    /** Image width */
    width: number;
    /** Image height */
    height: number;
}
/**
 * Function type for blending multiple layer values into a single output value.
 *
 * @param ctx - Context containing pixel values, weights, and position info
 * @returns The blended output value (should be in 0-1 range)
 *
 * @example Custom blend function
 * ```typescript
 * const softMin: BlendFunction = (ctx) => {
 *   // Soft minimum using negative log-sum-exp
 *   const k = 10; // sharpness parameter
 *   const sumExp = ctx.values.reduce((sum, v) => sum + Math.exp(-k * v), 0);
 *   return -Math.log(sumExp / ctx.values.length) / k;
 * };
 * ```
 */
type BlendFunction = (ctx: BlendContext) => number;
/**
 * Weighted average blend - smoothly combines all layers
 *
 * Best for: Balanced multi-scale results, general purpose
 */
declare const blendAverage: BlendFunction;
/**
 * Minimum blend - takes the darkest value at each pixel
 *
 * Best for: Preserving fine details, ensuring all edges are captured
 * Since edges are dark (0) on white (1), min keeps all detected edges
 */
declare const blendMin: BlendFunction;
/**
 * Maximum blend - takes the brightest value at each pixel
 *
 * Best for: Abstract styles where only strong edges should appear
 * Removes edges that don't appear in all scales
 */
declare const blendMax: BlendFunction;
/**
 * Multiply blend - multiplies all layer values together
 *
 * Best for: Strong edge emphasis, high contrast results
 * Areas that are dark in any layer become very dark
 */
declare const blendMultiply: BlendFunction;
/**
 * Screen blend - inverse of multiply, brightens the result
 *
 * Best for: Lighter, more ethereal line drawings
 */
declare const blendScreen: BlendFunction;
/**
 * Soft light blend - subtle contrast enhancement
 *
 * Best for: Natural-looking multi-scale combination
 */
declare const blendSoftLight: BlendFunction;
/**
 * Overlay blend - combines multiply and screen based on base value
 *
 * Best for: High contrast results that preserve both highlights and shadows
 */
declare const blendOverlay: BlendFunction;
/**
 * Geometric mean blend - multiplicative average, less extreme than multiply
 *
 * Best for: Balanced darkening that respects layer weights
 */
declare const blendGeometricMean: BlendFunction;
/**
 * Harmonic mean blend - emphasizes smaller values more than arithmetic mean
 *
 * Best for: Preserving fine details while still allowing averaging
 */
declare const blendHarmonicMean: BlendFunction;
/**
 * Median blend - selects the middle value, robust to outliers
 *
 * Best for: Noise-resistant combination when layer count is odd
 */
declare const blendMedian: BlendFunction;
/**
 * Soft min blend - smooth approximation of minimum using log-sum-exp
 *
 * Best for: Capturing all edges with smoother transitions than hard min
 */
declare const blendSoftMin: BlendFunction;
/**
 * Soft max blend - smooth approximation of maximum using log-sum-exp
 *
 * Best for: Selecting dominant edges with smoother transitions than hard max
 */
declare const blendSoftMax: BlendFunction;
/**
 * Difference blend - absolute difference between layers (best with 2 layers)
 *
 * Best for: Highlighting scale-dependent features, edge comparison
 */
declare const blendDifference: BlendFunction;
/**
 * Priority blend - uses fine scale unless coarse scale has strong edges
 *
 * Best for: Detail preservation with fallback to coarse structure
 * Assumes layers ordered fine-to-coarse (first = finest detail)
 */
declare const blendPriority: BlendFunction;
/**
 * Collection of all built-in blend functions for easy access
 */
declare const BlendFunctions: Record<string, BlendFunction>;
/**
 * Type representing the names of built-in blend functions
 */
type BuiltinBlendMode = keyof typeof BlendFunctions;
/**
 * Configuration for a single scale layer
 */
interface MultiScaleLayer {
    /** Pre-configured XDoG or FDoG processor instance */
    processor: DoGImplementation;
    /** Weight for blending (will be normalized) */
    weight: number;
}
/**
 * Multi-scale configuration
 */
interface MultiScaleConfig {
    /** Layer specifications with processor instances */
    layers: MultiScaleLayer[];
    /**
     * Blend function for combining layers.
     *
     * Can be either:
     * - A built-in blend function from BlendFunctions (e.g., BlendFunctions.min)
     * - A custom BlendFunction
     *
     * @example Using built-in
     * ```typescript
     * { layers: [...], blend: BlendFunctions.average }
     * ```
     *
     * @example Using custom function
     * ```typescript
     * {
     *   layers: [...],
     *   blend: (ctx) => {
     *     // Custom logic using ctx.values, ctx.weights, ctx.x, ctx.y
     *     return Math.min(...ctx.values) * 0.8 + ctx.values[0] * 0.2;
     *   }
     * }
     * ```
     */
    blend: BlendFunction;
}
/**
 * Multi-Scale Strategy
 *
 * Combines XDoG/FDoG results at different scales for scale-space
 * edge detection. Accepts pre-configured processor instances, giving
 * developers full control over each layer's configuration.
 *
 * From Section 3.1 (Abstraction): Different σ values capture different
 * levels of detail.
 *
 * @example Using built-in blend function
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.5, p: 30 }), weight: 1 },
 *     { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 2 },
 *   ],
 *   blend: BlendFunctions.min,
 * });
 * const result = await multiScale.apply(input);
 * ```
 *
 * @example Using custom blend function
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.4, p: 20 }), weight: 2 },
 *     { processor: new FDoG({ sigma: 1.6, sigmaM: 4.0 }), weight: 1 },
 *   ],
 *   blend: (ctx) => {
 *     // Weighted geometric mean
 *     let logSum = 0;
 *     for (let i = 0; i < ctx.values.length; i++) {
 *       logSum += ctx.weights[i] * Math.log(ctx.values[i] + 0.001);
 *     }
 *     return Math.exp(logSum);
 *   },
 * });
 * ```
 *
 * @example Position-dependent blending
 * ```typescript
 * const vignetteBlend: BlendFunction = (ctx) => {
 *   // Use fine details in center, coarse at edges
 *   const cx = ctx.width / 2, cy = ctx.height / 2;
 *   const dist = Math.sqrt((ctx.x - cx) ** 2 + (ctx.y - cy) ** 2);
 *   const maxDist = Math.sqrt(cx ** 2 + cy ** 2);
 *   const t = dist / maxDist; // 0 at center, 1 at corners
 *
 *   // Interpolate between first layer (fine) and last layer (coarse)
 *   return ctx.values[0] * (1 - t) + ctx.values[ctx.values.length - 1] * t;
 * };
 * ```
 */
declare class MultiScaleStrategy implements ExtensionStrategy<MultiScaleConfig, ChannelImage, ChannelImage> {
    private config;
    constructor(config: MultiScaleConfig);
    apply(input: ChannelImage, configOverride?: Partial<Pick<MultiScaleConfig, 'blend'>>): Promise<ChannelImage>;
    private blendLayers;
    /**
     * Create a preset multi-scale configuration
     */
    static withPreset(preset: 'detailed' | 'balanced' | 'abstract'): MultiScaleStrategy;
    /**
     * Get the configured layers (useful for inspection/debugging)
     */
    getLayers(): ReadonlyArray<MultiScaleLayer>;
    /**
     * Get the blend function
     */
    getBlendFunction(): BlendFunction;
}
/**
 * Creates a weighted percentile blend function
 *
 * @param percentile - Value from 0 to 1 (0 = min, 0.5 = median, 1 = max)
 * @returns A blend function that selects the given percentile
 *
 * @example
 * ```typescript
 * const medianBlend = createPercentileBlend(0.5);
 * const multiScale = new MultiScaleStrategy({
 *   layers: [...],
 *   blend: medianBlend,
 * });
 * ```
 */
declare function createPercentileBlend(percentile: number): BlendFunction;
/**
 * Creates a blend function that interpolates between two other blend functions
 * based on a spatial mask or gradient
 *
 * @param blendA - First blend function
 * @param blendB - Second blend function
 * @param mixer - Function that returns interpolation factor (0 = use A, 1 = use B)
 * @returns Combined blend function
 *
 * @example Radial gradient between min and average
 * ```typescript
 * const radialBlend = createMixedBlend(
 *   BlendFunctions.min,
 *   BlendFunctions.average,
 *   (ctx) => {
 *     const cx = ctx.width / 2, cy = ctx.height / 2;
 *     const dist = Math.hypot(ctx.x - cx, ctx.y - cy);
 *     const maxDist = Math.hypot(cx, cy);
 *     return dist / maxDist;
 *   }
 * );
 * ```
 */
declare function createMixedBlend(blendA: BlendFunction, blendB: BlendFunction, mixer: (ctx: BlendContext) => number): BlendFunction;
/**
 * Creates a blend function that applies gamma correction to another blend
 *
 * @param baseBlend - The base blend function
 * @param gamma - Gamma value (< 1 brightens, > 1 darkens)
 * @returns Gamma-corrected blend function
 */
declare function createGammaCorrectedBlend(baseBlend: BlendFunction, gamma: number): BlendFunction;

type multiScale_BlendContext = BlendContext;
type multiScale_BlendFunction = BlendFunction;
declare const multiScale_BlendFunctions: typeof BlendFunctions;
type multiScale_BuiltinBlendMode = BuiltinBlendMode;
type multiScale_MultiScaleConfig = MultiScaleConfig;
type multiScale_MultiScaleLayer = MultiScaleLayer;
type multiScale_MultiScaleStrategy = MultiScaleStrategy;
declare const multiScale_MultiScaleStrategy: typeof MultiScaleStrategy;
declare const multiScale_blendAverage: typeof blendAverage;
declare const multiScale_blendDifference: typeof blendDifference;
declare const multiScale_blendGeometricMean: typeof blendGeometricMean;
declare const multiScale_blendHarmonicMean: typeof blendHarmonicMean;
declare const multiScale_blendMax: typeof blendMax;
declare const multiScale_blendMedian: typeof blendMedian;
declare const multiScale_blendMin: typeof blendMin;
declare const multiScale_blendMultiply: typeof blendMultiply;
declare const multiScale_blendOverlay: typeof blendOverlay;
declare const multiScale_blendPriority: typeof blendPriority;
declare const multiScale_blendScreen: typeof blendScreen;
declare const multiScale_blendSoftLight: typeof blendSoftLight;
declare const multiScale_blendSoftMax: typeof blendSoftMax;
declare const multiScale_blendSoftMin: typeof blendSoftMin;
declare const multiScale_createGammaCorrectedBlend: typeof createGammaCorrectedBlend;
declare const multiScale_createMixedBlend: typeof createMixedBlend;
declare const multiScale_createPercentileBlend: typeof createPercentileBlend;
declare namespace multiScale {
  export { multiScale_BlendFunctions as BlendFunctions, multiScale_MultiScaleStrategy as MultiScaleStrategy, multiScale_blendAverage as blendAverage, multiScale_blendDifference as blendDifference, multiScale_blendGeometricMean as blendGeometricMean, multiScale_blendHarmonicMean as blendHarmonicMean, multiScale_blendMax as blendMax, multiScale_blendMedian as blendMedian, multiScale_blendMin as blendMin, multiScale_blendMultiply as blendMultiply, multiScale_blendOverlay as blendOverlay, multiScale_blendPriority as blendPriority, multiScale_blendScreen as blendScreen, multiScale_blendSoftLight as blendSoftLight, multiScale_blendSoftMax as blendSoftMax, multiScale_blendSoftMin as blendSoftMin, multiScale_createGammaCorrectedBlend as createGammaCorrectedBlend, multiScale_createMixedBlend as createMixedBlend, multiScale_createPercentileBlend as createPercentileBlend };
  export type { multiScale_BlendContext as BlendContext, multiScale_BlendFunction as BlendFunction, multiScale_BuiltinBlendMode as BuiltinBlendMode, multiScale_MultiScaleConfig as MultiScaleConfig, multiScale_MultiScaleLayer as MultiScaleLayer };
}

/**
 * Convert ImageData to RGBImage
 */
declare function imageDataToRGB(imageData: ImageData): RGBImage;
/**
 * Convert RGBImage to ImageData
 */
declare function rgbToImageData(rgb: RGBImage): ImageData;
/**
 * Convert grayscale to RGB (same value in all channels)
 */
declare function grayscaleToRGB(gray: ChannelImage): RGBImage;

/**
 * XDoG/FDoG Extensions Module
 *
 * Provides composable strategy patterns for extending XDoG/FDoG output:
 * - Hatching: Multiple threshold masks for tonal art maps
 * - Natural Media: Pencil, pastel, charcoal effects via parameter tuning
 * - Anti-aliasing: LIC pass along edge tangent flow
 * - Color Retention: Modulating stylized output with source colors
 * - Multi-scale: Combining results at different σ values
 *
 * Based on Sections 4.3, 5.1, 5.2 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 *
 * Design Philosophy:
 * - Each extension is a standalone strategy that can be composed
 * - Developers control XDoG vs FDoG choice and parameters
 * - Extensions accept pre-processed results or raw images
 * - Chainable pipeline architecture
 */

type index_AntiAliasingConfig = AntiAliasingConfig;
type index_AntiAliasingStrategy = AntiAliasingStrategy;
declare const index_AntiAliasingStrategy: typeof AntiAliasingStrategy;
type index_BlendContext = BlendContext;
type index_BlendFunction = BlendFunction;
type index_BuiltinBlendMode = BuiltinBlendMode;
type index_Color = Color;
type index_ColorRetentionConfig = ColorRetentionConfig;
type index_ColorTransformFn = ColorTransformFn;
type index_DoGResult = DoGResult;
type index_ExtensionStrategy<TConfig, TInput, TOutput> = ExtensionStrategy<TConfig, TInput, TOutput>;
type index_HatchTexture = HatchTexture;
type index_HatchingConfig = HatchingConfig;
type index_HatchingStrategy = HatchingStrategy;
declare const index_HatchingStrategy: typeof HatchingStrategy;
type index_MaskTransformFn = MaskTransformFn;
type index_MultiScaleConfig = MultiScaleConfig;
type index_MultiScaleLayer = MultiScaleLayer;
type index_NaturalMediaConfig = NaturalMediaConfig;
type index_NaturalMediaStrategy = NaturalMediaStrategy;
declare const index_NaturalMediaStrategy: typeof NaturalMediaStrategy;
type index_NaturalMediaStyle = NaturalMediaStyle;
type index_PostProcessFn = PostProcessFn;
declare const index_colorRetention: typeof colorRetention;
declare const index_grayscaleToRGB: typeof grayscaleToRGB;
declare const index_imageDataToRGB: typeof imageDataToRGB;
declare const index_multiScale: typeof multiScale;
declare const index_rgbToImageData: typeof rgbToImageData;
declare namespace index {
  export { index_AntiAliasingStrategy as AntiAliasingStrategy, index_HatchingStrategy as HatchingStrategy, index_NaturalMediaStrategy as NaturalMediaStrategy, index_colorRetention as colorRetention, index_grayscaleToRGB as grayscaleToRGB, index_imageDataToRGB as imageDataToRGB, index_multiScale as multiScale, index_rgbToImageData as rgbToImageData };
  export type { index_AntiAliasingConfig as AntiAliasingConfig, index_BlendContext as BlendContext, index_BlendFunction as BlendFunction, index_BuiltinBlendMode as BuiltinBlendMode, index_Color as Color, index_ColorRetentionConfig as ColorRetentionConfig, index_ColorTransformFn as ColorTransformFn, index_DoGResult as DoGResult, index_ExtensionStrategy as ExtensionStrategy, index_HatchTexture as HatchTexture, index_HatchingConfig as HatchingConfig, index_MaskTransformFn as MaskTransformFn, index_MultiScaleConfig as MultiScaleConfig, index_MultiScaleLayer as MultiScaleLayer, index_NaturalMediaConfig as NaturalMediaConfig, index_NaturalMediaStyle as NaturalMediaStyle, index_PostProcessFn as PostProcessFn };
}

export { DEFAULT_ETF_CONFIG, DoGProcessor, EdgeTangentFlowComputer, ThresholdModes, applyCustomThreshold, index$3 as blur, index$4 as dog, index as extensions, index$2 as preprocess, threshold, index$1 as utilities };
export type { ADoGConfig, ADoGProcessingResult, ADogConfigParamType, AntiAliasingConfig, BackendOptions, BilateralFilterConfig, BlendFunction, BlurStrategy, ChannelImage, ColorRetentionConfig, ColorTransformFn, DoGConfig, DoGImplementation, DoGResult, DogConfigParamType, ETFConfig, ExtensionStrategy, FDoGConfig, FDogConfigParamType, FlowField, FlowGuidedBlurConfig, GradientAlignedBlurConfig, HDoGConfig, HDoGProcessingResult, HDogConfigParamType, HatchTexture, HatchingConfig, IsotropicBlurConfig, KuwaharaFilterConfig, LocalVarianceConfig, MaskTransformFn, MedianFilterConfig, MultiScaleConfig, MultiScaleLayer, NaturalMediaConfig, NaturalMediaStyle, ParamRange, PostProcessFn, Preprocessor, RGBImage$1 as RGBImage, ThresholdConfig, ThresholdStrategy, Vec2, XDoGConfig };
