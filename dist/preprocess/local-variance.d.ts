/**
 * # Texture-Aware Edge Detection: Local Variance Preprocessing
 *
 * ## Conceptual Overview
 *
 * The Local Variance Preprocessor addresses a fundamental limitation of standard XDoG/FDoG:
 * texture creates false edges that clutter the output. This preprocessor distinguishes
 * texture regions from structural regions by computing local variance at each pixel.
 *
 * The output is a **texture strength map** (not edge map) that you then use to create
 * **adaptive parameters** for XDoG/FDoG/HDoG.
 *
 * ## Pipeline Workflow
 *
 * ```
 * Input Image
 *   ↓
 * [LocalVariancePreprocessor.process(image)]
 *   ↓
 * Texture Strength Map (Float32Array, values 0-1)
 *   ├─ 0 = pure structure (object boundaries)
 *   └─ 1 = pure texture (fabric weave, skin pores, foliage, etc.)
 *   ↓
 * [Create Adaptive XDoG Parameters]
 * τ_adaptive = τ_base + α × texture_strength
 * ε_adaptive = ε_base + β × texture_strength
 *   ↓
 * [Run XDoG/FDoG/HDoG with adaptive parameters]
 *   ↓
 * High-quality Edge Map (texture suppressed, structure preserved)
 * ```
 *
 * ## Why This Works
 *
 * Standard XDoG uses constant parameters across the entire image:
 * - `τ = 0.95` everywhere means same edge suppression in texture and structure regions
 * - Result: Either suppresses textures (loses details) or preserves them (cluttered edges)
 *
 * Texture-aware XDoG adapts the inhibition parameter:
 * - Structure regions (texture_strength ≈ 0): τ ≈ 0.95 (normal edge detection)
 * - Texture regions (texture_strength ≈ 1): τ ≈ 1.25 (strong suppression)
 * - Transition regions blend smoothly between both
 *
 * This allows **selective suppression**: texture edges die out while structural edges remain.
 *
 * ## Implementation Pattern
 *
 * ```typescript
 * // Step 1: Detect texture regions (preprocessing)
 * const preprocessor = new LocalVariancePreprocessor({
 *   windowRadius: 2,           // 5×5 window
 *   normalizeByGradient: true, // Distinguish texture from edges
 * });
 * const textureMap = preprocessor.process(grayImage);
 * // textureMap.data is Float32Array where each value ∈ [0, 1]
 *
 * // Step 2: Create adaptive XDoG parameters (external to preprocessor)
 * const τ_base = 0.95;
 * const α = 0.3;  // Texture sensitivity
 * const τ_adaptive = new Float32Array(textureMap.data.length);
 * for (let i = 0; i < τ_adaptive.length; i++) {
 *   τ_adaptive[i] = τ_base + α * textureMap.data[i];
 * }
 *
 * // Step 3: Run XDoG with adaptive parameters (standard XDoG code)
 * const gaussian_σ = gaussianBlur(grayImage, 1.5);
 * const gaussian_kσ = gaussianBlur(grayImage, 1.5 * 1.6);
 *
 * const xdog = new Float32Array(grayImage.data.length);
 * for (let i = 0; i < xdog.length; i++) {
 *   // Use τ_adaptive[i] instead of constant τ_base
 *   xdog[i] = gaussian_σ.data[i] - τ_adaptive[i] * gaussian_kσ.data[i];
 * }
 *
 * const edgeMap = softThreshold(xdog, epsilon, phi);
 * ```
 *
 * ## What the Preprocessor Computes
 *
 * For each pixel (x, y), the local variance is computed in a window W:
 *
 * ```
 * variance(x,y) = E[X²] - E[X]²
 *   where E[X] = mean of pixel values in window W
 *   where E[X²] = mean of squared pixel values in window W
 * ```
 *
 * **Intuition**:
 * - Smooth regions (sky, uniform fabric): low variance
 * - Textured regions (grass, patterned fabric): high variance
 * - Structural edges (object boundary): medium variance + high gradient
 *
 * **Gradient Normalization** (if enabled):
 * ```
 * texture_strength = variance / (1 + |∇I|²)
 * ```
 *
 * This prevents suppressing subtle edges that happen to have variance (e.g., wrinkles).
 * - High variance + high gradient → likely a real edge → texture_strength reduced
 * - High variance + low gradient → likely texture → texture_strength preserved
 *
 * ## Configuration Options
 *
 * | Parameter | Default | Range | Effect |
 * |-----------|---------|-------|--------|
 * | `windowRadius` | 2 | 1-4 | Size of variance window (1=3×3, 2=5×5, 3=7×7, 4=9×9) |
 * | `normalizeByGradient` | true | - | Divide by gradient to avoid suppressing edges |
 * | `varianceScale` | 1.0 | 0.5-3.0 | Multiply variance before normalizing (amplify/dampen) |
 * | `maxVariance` | undefined | 0-1 | Clamp maximum texture_strength (optional) |
 *
 * **Tuning Guide**:
 * - **windowRadius**: Larger = smoother texture map, slower computation
 *   - Use 2 (5×5) for most applications
 *   - Use 3 (7×7) for very fine texture details
 * - **normalizeByGradient**: Should usually be `true`
 *   - Set `false` for sketches/technical drawings where variance indicates structure
 * - **varianceScale**: Controls sensitivity to texture
 *   - Increase (2.0-3.0) if textures are subtle
 *   - Decrease (0.5-1.0) if too much suppression
 * - **maxVariance**: Rarely needed; useful if some regions are overly textured
 *
 * ## Integration with XDoG Variants
 *
 * The texture map is domain-agnostic and works with all XDoG variants:
 *
 * **Standard XDoG**:
 * ```
 * τ_map[i] = τ_base + α * texture_map.data[i]
 * xdog[i] = G_σ[i] - τ_map[i] * G_kσ[i]
 * ```
 *
 * **FDoG (Flow-based)**: Same approach, just apply τ_map to anisotropic Gaussians
 * ```
 * gaussian_σ = anisotropicBlur(image, σ, structure_tensor)
 * gaussian_kσ = anisotropicBlur(image, k*σ, structure_tensor)
 * xdog[i] = gaussian_σ[i] - τ_map[i] * gaussian_kσ[i]
 * ```
 *
 * **HDoG (Line + Tone)**: Apply separately to both components
 * ```
 * τ_line[i] = τ_line_base + α_line * texture_map.data[i]
 * τ_tone[i] = τ_tone_base + α_tone * texture_map.data[i]
 * line_output[i] = G_σ[i] - τ_line[i] * G_kσ[i]
 * tone_output[i] = G_σ2[i] - τ_tone[i] * G_kσ2[i]
 * ```
 *
 * ## Stacking with Other Preprocessors
 *
 * Local Variance can be combined with other texture detection methods
 * (Spectral Analysis, Patch-based Contrast) for more robust texture detection:
 *
 * ```typescript
 * const varianceMap = new LocalVariancePreprocessor().process(image);
 * const spectralMap = new SpectralPreprocessor().process(image);
 * const patchMap = new PatchContrastPreprocessor().process(image);
 *
 * // Combine with weights
 * const textureMap = new Float32Array(image.data.length);
 * for (let i = 0; i < textureMap.length; i++) {
 *   textureMap[i] = 0.3 * varianceMap.data[i] +
 *                   0.4 * spectralMap.data[i] +
 *                   0.3 * patchMap.data[i];
 * }
 *
 * // Use combined map with XDoG
 * const edgeMap = myXDoG.process(image, {tau: textureMap});
 * ```
 *
 * ## Notes
 *
 * - This preprocessor is **NOT integrated into XDoG/FDoG/HDoG**.
 *   It outputs a texture map that you use externally to create adaptive parameters.
 * - The texture map is computed **once** and can be reused with different XDoG parameters.
 * - For best results, tune `textureAlpha` (α parameter in τ_adaptive) per application domain.
 * - Consider using the Optimized version for real-time applications.
 *
 * @see {@link LocalVarianceConfig} for configuration options
 * @see {@link LocalVariancePreprocessorOptimized} for faster computation using separable filters
 */
/**
 * Local Variance Texture Detection Preprocessor
 *
 * This module provides texture detection as a reusable preprocessing step.
 * It computes texture strength maps that can be:
 *
 * 1. Used directly with your own XDoG/FDoG/HDoG implementation
 * 2. Combined with other texture detection methods (Spectral, Patch-based, etc.)
 * 3. Tuned independently from edge detection logic
 *
 * Usage Pattern:
 * ```
 * const textureMap = preprocessor.process(image);
 * // textureMap is a ChannelImage where each pixel value = texture strength (0-1)
 * // 0 = pure structure, 1 = pure texture
 *
 * // Then pass to your edge detection:
 * const edgeMap = myXDoG.process(image, {tau: textureMap});
 * // or combine with other texture maps:
 * const combinedMap = combineTextureMaps([textureMap1, textureMap2, textureMap3]);
 * const edgeMap = myXDoG.process(image, {tau: combinedMap});
 * ```
 *
 * This separation of concerns allows:
 * - Stacking multiple texture detection methods
 * - Testing texture detection independently from edge detection
 * - Swapping XDoG/FDoG/HDoG implementations without changing preprocessor
 * - Different parameter tuning for different algorithms
 */
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
 * Configuration for Local Variance Texture Detection
 *
 * These parameters control how texture is detected. They are independent
 * from XDoG/FDoG/HDoG parameters - you tune them separately based on the
 * image characteristics you're working with.
 */
export interface LocalVarianceConfig {
    /**
     * Window radius for variance computation
     * Examples:
     * - 1 = 3×3 window (fast, fine detail)
     * - 2 = 5×5 window (recommended, balanced)
     * - 3 = 7×7 window (slower, coarser texture detection)
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
     *   - Formula: texture *= 1 / (1 + gradient²)
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
export declare class LocalVariancePreprocessor {
    private config;
    constructor(config?: Partial<LocalVarianceConfig>);
    /**
     * Compute texture strength map from image
     *
     * @param image Input grayscale image (Float32Array, 0-1 normalized)
     * @returns ChannelImage containing texture strength values
     *          Each pixel: 0 = pure structure (edges, boundaries)
     *                     1 = pure texture (patterns, fine details)
     *          Developer uses these values to adapt XDoG parameters
     */
    process(image: ChannelImage): ChannelImage;
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
 * Uses separable convolution: O(n × r) instead of O(n × r²)
 *
 * Approach: Variance = E[X²] - E[X]²
 * - Compute box blur of image (gives E[X])
 * - Compute box blur of image squared (gives E[X²])
 * - Subtract to get variance
 *
 * Performance:
 * - Basic version: ~1-2ms for 1080p (5×5 window)
 * - Optimized version: ~0.5ms for 1080p (5×5 window)
 * - 3-4x faster for large windows
 *
 * Use this for real-time applications. Basic version is fine for batch processing.
 */
export declare class LocalVariancePreprocessorOptimized {
    private config;
    constructor(config?: Partial<LocalVarianceConfig>);
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X²] - E[X]²
     * Compute box blur of X and X² separately, then combine
     */
    process(image: ChannelImage): ChannelImage;
    /**
     * Fast box blur using separable convolution
     * O(n) instead of O(n * r²)
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
 * USAGE PATTERNS
 *
 * Pattern 1: Single texture detection preprocessing
 * ```
 * const preprocessor = new LocalVariancePreprocessor({
 *   windowRadius: 2,           // 5×5 window
 *   normalizeByGradient: true,
 *   varianceScale: 2.0,
 * });
 *
 * const textureMap = preprocessor.process(grayImage);
 * // textureMap: ChannelImage with texture strength (0-1) at each pixel
 *
 * // Pass to your XDoG/FDoG/HDoG implementation
 * const edgeMap = myXDoGImplementation.process(grayImage, textureMap);
 * ```
 *
 * Pattern 2: Stacking multiple texture detection methods
 * ```
 * const varianceMap = new LocalVariancePreprocessor().process(grayImage);
 * const spectralMap = new SpectralPreprocessor().process(grayImage);
 * const patchMap = new PatchContrastPreprocessor().process(grayImage);
 *
 * // Combine with weighted average
 * const combinedTexture = new Float32Array(grayImage.data.length);
 * for (let i = 0; i < combinedTexture.length; i++) {
 *   combinedTexture[i] =
 *     0.3 * varianceMap.data[i] +
 *     0.4 * spectralMap.data[i] +
 *     0.3 * patchMap.data[i];
 * }
 *
 * const textureMapCombined: ChannelImage = {
 *   data: combinedTexture,
 *   width: grayImage.width,
 *   height: grayImage.height,
 * };
 *
 * const edgeMap = myXDoGImplementation.process(grayImage, textureMapCombined);
 * ```
 *
 * Pattern 3: Using optimized version for real-time
 * ```
 * const optimized = new LocalVariancePreprocessorOptimized({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 *   varianceScale: 2.0,
 * });
 *
 * const textureMap = optimized.process(grayImage);  // ~0.5ms @ 1080p
 * const edgeMap = myFDoGImplementation.process(grayImage, textureMap);
 * ```
 *
 * Pattern 4: Visualizing texture detection
 * ```
 * const textureMap = preprocessor.process(grayImage);
 * // Save textureMap as image to debug texture detection accuracy
 * // Values 0-1 mapped to grayscale: black=structure, white=texture
 * ```
 */ 
//# sourceMappingURL=local-variance.d.ts.map