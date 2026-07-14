/**
 * Compiles a `DogProcessingContext` (the declarative config tree) down into an
 * executable tree of real `DoGImplementation` instances, and runs that tree
 * against an input image.
 *
 * Two entry points:
 *   - `buildExecutablePlan(context)` — config -> executables (no image processing yet)
 *   - `executeDogExecutablePlan(plan, input)` — executables -> ChannelImage
 *   - `executeDogProcessingContext(context, input)` — does both in one call
 */


import type { BlendFunction, DoGImplementation, BlurStrategy, ThresholdStrategy } from "dogpack";
import { XDoG, FDoG, ADoG, HDoG } from "dogpack/dog";
import { IsotropicBlur } from "dogpack/blur"; // adjust to actual export path
import { SoftThresholdStrategy, HardThresholdStrategy, HysteresisThresholdStrategy } from "dogpack/threshold"; // + Hysteresis once it exists
import type { Preprocessor, ChannelImage } from "dogpack";
import {
  DogConfigNode,
  DogExecutablePlan,
  DogExecutionLayer,
  DogExecutionLeaf,
  DogExecutionNode,
  DogLayer,
  DogNode,
  DogProcessingContext,
  BlurStrategyDescriptor,
  ThresholdStrategyDescriptor,
  WireADoGConfig,
  isConfig,
  isLayer,
} from "../models/dog";


export function isExecutionLayer(node: DogExecutionNode): node is DogExecutionLayer {
  return node.kind === "layer";
}

export function isExecutionLeaf(node: DogExecutionNode): node is DogExecutionLeaf {
  return node.kind === "dog";
}

// =============================================================================
// 1. Build: DogNode[] -> DogExecutionNode[]
// =============================================================================


function createBlurStrategy(descriptor: BlurStrategyDescriptor): BlurStrategy {
  switch (descriptor.kind) {
    case "isotropic":
      return new IsotropicBlur({ kernelSizeMultiplier: descriptor.kernelSizeMultiplier ?? 6 });
    case "gradient-aligned":
    case "flow-guided":
      // These wrap a FlowField computed at runtime from the actual input
      // image -- there's no way to rebuild one from a plain descriptor.
      // FDoG already constructs these internally; if you need to inject one
      // from outside, do it worker-side after the ETF exists, not here.
      throw new Error(
        `Cannot reconstruct a "${descriptor.kind}" blur strategy from a wire descriptor alone -- it requires a runtime FlowField.`
      );
    default: {
      const exhaustiveCheck: never = descriptor;
      throw new Error(`Unsupported blur strategy descriptor: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function createThresholdStrategy(descriptor: ThresholdStrategyDescriptor): ThresholdStrategy {
  switch (descriptor.kind) {
    case "soft":
      return new SoftThresholdStrategy();
    case "hard":
      return new HardThresholdStrategy();
    case "hysteresis":
      // Defaults mirror DogComponent's form defaults (0.2/0.2) so a
      // descriptor built without explicit offsets behaves the same as the
      // form's untouched initial state.
      return new HysteresisThresholdStrategy(
        descriptor.highOffset ?? 0.2,
        descriptor.lowOffset ?? 0.2,
      );
    default: {
      const exhaustiveCheck: never = descriptor;
      throw new Error(`Unsupported threshold strategy descriptor: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function hydrateThresholdStrategy<T extends { thresholdStrategy?: ThresholdStrategyDescriptor }>(
  config: T
): Omit<T, "thresholdStrategy"> & { thresholdStrategy?: ThresholdStrategy } {
  const { thresholdStrategy, ...rest } = config;
  return {
    ...rest,
    ...(thresholdStrategy ? { thresholdStrategy: createThresholdStrategy(thresholdStrategy) } : {}),
  };
}

/** Shared by ADoG leaves and HDoG's nested adog/adogSecondary configs. */
function hydrateADoGConfig(config: Partial<WireADoGConfig>) {
  const { thresholdStrategy, ...rest } = config;
  return {
    ...rest,
    ...(thresholdStrategy ? { thresholdStrategy: createThresholdStrategy(thresholdStrategy) } : {}),
  };
}

function createDoGImplementation(node: DogConfigNode): DoGImplementation {
  switch (node.type) {
    case "xdog": {
      const { blurStrategy, ...rest } = node.config;
      return new XDoG({
        ...hydrateThresholdStrategy(rest),
        ...(blurStrategy ? { blurStrategy: createBlurStrategy(blurStrategy) } : {}),
      });
    }
    case "fdog":
      return new FDoG(hydrateThresholdStrategy(node.config));
    case "adog":
      return new ADoG(hydrateThresholdStrategy(node.config));
    case "hdog": {
      const { fdog, adog, adogSecondary, ...rest } = node.config;
      return new HDoG({
        ...rest,
        ...(fdog ? { fdog: hydrateThresholdStrategy(fdog) } : {}),
        ...(adog ? { adog: hydrateThresholdStrategy(adog) } : {}),
        ...(adogSecondary ? { adogSecondary: hydrateThresholdStrategy(adogSecondary) } : {}),
      });
    }
    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unsupported DoG component type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}


function buildExecutionLeaf(node: DogConfigNode): DogExecutionLeaf {
  return { kind: "dog", implementation: createDoGImplementation(node) };
}

function buildExecutionLayer(layer: DogLayer): DogExecutionLayer {
  const components = layer.components.map(buildExecutionNode);
  return {
    kind: "layer",
    name: layer.name,
    components,
    // Only carry the blend mode forward if it will actually be used.
    blendMode: components.length > 1 ? layer.blendMode : undefined,
  };
}

function buildExecutionNode(node: DogNode): DogExecutionNode {
  if (isConfig(node)) {
    return buildExecutionLeaf(node);
  }

  if (isLayer(node)) {
    return buildExecutionLayer(node);
  }

  const exhaustiveCheck: never = node;
  throw new Error(`Unsupported DogNode: ${JSON.stringify(exhaustiveCheck)}`);
}

/** Convert a `DogNode[]` tree (e.g. `DogProcessingContext.dog`) into executables. */
export function buildExecutionTree(nodes: DogNode[]): DogExecutionNode[] {
  return nodes.map(buildExecutionNode);
}

/** Convert a full `DogProcessingContext` into an executable plan. */
export function buildExecutablePlan(context: DogProcessingContext): DogExecutablePlan {
  return {
    dog: buildExecutionTree(context.dog),
  };
}

// =============================================================================
// 2. Execute: DogExecutionNode[] + ChannelImage -> ChannelImage
// =============================================================================

function createChannelImage(width: number, height: number): ChannelImage {
  return { data: new Float32Array(width * height), width, height };
}

/** Equal-weight average — used as a safety-net default if a layer with more than
 * one component somehow has no blendMode set. */
const equalWeightAverage: BlendFunction = (ctx) => {
  let sum = 0;
  for (let i = 0; i < ctx.values.length; i++) {
    sum += ctx.values[i] * ctx.weights[i];
  }
  return sum;
};

/**
 * Blends N same-size ChannelImages pixel-by-pixel using the given blend
 * function. All components in a layer are given equal weight — neither
 * `DogLayer` nor `DogExecutionLayer` carry per-component weights (unlike
 * `MultiScaleLayer`, which does).
 */
function blendChannelImages(images: ChannelImage[], blend: BlendFunction): ChannelImage {
  const { width, height } = images[0];
  const output = createChannelImage(width, height);

  const weight = 1 / images.length;
  const weights = new Array<number>(images.length).fill(weight);
  const values = new Array<number>(images.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let j = 0; j < images.length; j++) {
        values[j] = images[j].data[i];
      }
      output.data[i] = blend({ values, weights, x, y, width, height });
    }
  }

  return output;
}

/** Run a single executable node (leaf DoG or nested layer) against an image. */
export async function executeDogNode(
  node: DogExecutionNode,
  input: ChannelImage,
): Promise<ChannelImage> {
  if (isExecutionLayer(node)) {
    return executeDogLayer(node, input);
  }
  return node.implementation.process(input);
}

async function executeDogLayer(layer: DogExecutionLayer, input: ChannelImage): Promise<ChannelImage> {
  if (layer.components.length === 0) {
    return input;
  }

  // Every component in a layer runs against the same source image, in parallel.
  const results = await Promise.all(
    layer.components.map((component) => executeDogNode(component, input)),
  );

  if (results.length === 1) {
    return results[0];
  }

  return blendChannelImages(results, layer.blendMode ?? equalWeightAverage);
}

function executeDogPipeline(
  nodes: DogExecutionNode[],
  input: ChannelImage,
): Promise<ChannelImage> {
  return nodes.reduce<Promise<ChannelImage>>(
    (imagePromise, node) =>
      imagePromise.then(async (image) => {
        try {
          return await executeDogNode(node, image);
        } finally {
          disposeExecutionTree([node]);
        }
      }),
    Promise.resolve(input),
  );
}
 
function applyPreprocessing(preprocessors: Preprocessor[], input: ChannelImage): ChannelImage {
  return preprocessors.reduce((image, preprocessor) => preprocessor.process(image), input);
}

/** Execute an already-built plan (preprocessing + dog tree) against an input image. */
export async function executeDogExecutablePlan(
  plan: DogExecutablePlan,
  input: ChannelImage,
): Promise<ChannelImage> {
  return executeDogPipeline(plan.dog, input);
}

/** Convenience one-shot: build + execute directly from a `DogProcessingContext`. */
export async function executeDogProcessingContext(
  context: DogProcessingContext,
  input: ChannelImage,
): Promise<ChannelImage> {
  const plan = buildExecutablePlan(context);
  console.log(plan);
  return executeDogExecutablePlan(buildExecutablePlan(context), input);
}

/** Recursively dispose every DoG implementation instance in a built tree. */
export function disposeExecutionTree(nodes: DogExecutionNode[]): void {
  for (const node of nodes) {
    if (isExecutionLayer(node)) {
      disposeExecutionTree(node.components);
    } else {
      node.implementation.dispose();
    }
  }
}