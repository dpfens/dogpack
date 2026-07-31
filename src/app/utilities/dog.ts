import type { BlendFunction, DoGImplementation, BlurStrategy, ThresholdStrategy } from "dogpack";
import { XDoG, FDoG, ADoG, HDoG } from "dogpack/dog";
import { IsotropicBlur } from "dogpack/blur";
import { SoftThresholdStrategy, HardThresholdStrategy, HysteresisThresholdStrategy } from "dogpack/threshold";
import type { ChannelImage } from "dogpack";
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
  AutoP,
  AutoEpsilon,
  AutoPhi,
  WireADoGConfig,
  isConfig,
  isLayer,
  XDogPreset,
  ADogPreset,
  FDogPreset,
  HDogPresetConfig,
} from "../models/dog";
import { multiScale } from "dogpack/extensions";
import { createChannelImage } from "dogpack/utils";
import { parameterEstimation } from "dogpack/preprocess";

export function isExecutionLayer(node: DogExecutionNode): node is DogExecutionLayer {
  return node.kind === "layer";
}
export function isExecutionLeaf(node: DogExecutionNode): node is DogExecutionLeaf {
  return node.kind === "dog";
}

// =============================================================================
// 0. Resolve: auto descriptors -> real per-pixel ChannelImages
//
// TODO(dog-component-parity): pull the actual per-pixel math out of
// DogComponent (gradient-magnitude blend for p, local-baseline+margin for
// epsilon, local-variance blend for phi — see dog.html's preview canvases)
// into this shared, Angular-free module, so DogComponent's live preview and
// this resolution import the *same* implementation instead of two that can
// drift apart. I don't have DogComponent's .ts, only dog.html, so these are
// structural stand-ins with the right shape (ChannelImage in, ChannelImage
// out, same width/height as the input) but placeholder per-pixel values.
// =============================================================================

async function resolveAutoP(auto: AutoP, image: ChannelImage): Promise<ChannelImage> {
  return await parameterEstimation.p.magnitudeAdaptiveEstimate(image, {
    pWeak: auto.weak,
    pStrong: auto.strong,
    smoothingSigma: auto.smoothingSigma,
  });
}
async function resolveAutoEpsilon(auto: AutoEpsilon, image: ChannelImage): Promise<ChannelImage> {
  return await parameterEstimation.epsilon.localBaselineEstimate(image, {
    sigma: auto.sigma,
    contrastMargin: auto.contrastMargin,
  });
}
async function resolveAutoPhi(auto: AutoPhi, image: ChannelImage): Promise<ChannelImage> {
  return await parameterEstimation.phi.varianceAdaptiveEstimate(image, {
    sigma: auto.sigma,
    phiSoft: auto.soft,
    phiHard: auto.hard,
  });
}

async function resolveP(p: number | AutoP | undefined, image: ChannelImage): Promise<number | ChannelImage | undefined> {
  if (p === undefined) return undefined;
  return typeof p === "number" ? p : await resolveAutoP(p, image);
}
async function resolveEpsilon(epsilon: number | AutoEpsilon | undefined, image: ChannelImage): Promise<number | ChannelImage | undefined> {
  if (epsilon === undefined) return undefined;
  return typeof epsilon === "number" ? epsilon : await resolveAutoEpsilon(epsilon, image);
}
async function resolvePhi(phi: number | AutoPhi | undefined, image: ChannelImage): Promise<number | ChannelImage | undefined> {
  if (phi === undefined) return undefined;
  return typeof phi === "number" ? phi : await resolveAutoPhi(phi, image);
}

// =============================================================================
// 1. Build: DogNode[] -> DogExecutionNode[]
//    Now takes the image everything in the tree will run against, purely so
//    p/epsilon/phi can be resolved to concrete numbers/ChannelImages before
//    a DoGImplementation is constructed. Nothing else about build changes —
//    implementations are still built here, same as before.
// =============================================================================

async function createBlurStrategy(descriptor: BlurStrategyDescriptor): Promise<BlurStrategy> {
  switch (descriptor.kind) {
    case "isotropic":
      return IsotropicBlur.create({ kernelSizeMultiplier: descriptor.kernelSizeMultiplier ?? 6 });
    case "gradient-aligned":
    case "flow-guided":
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
      return new HysteresisThresholdStrategy(descriptor.highOffset ?? 0.2, descriptor.lowOffset ?? 0.2);
    default: {
      const exhaustiveCheck: never = descriptor;
      throw new Error(`Unsupported threshold strategy descriptor: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Was `hydrateThresholdStrategy` — now also resolves p/epsilon/phi against
 * `image`. Everything else about this config passes through untouched.
 */
async function hydrateAutoConfig<
  T extends {
    thresholdStrategy?: ThresholdStrategyDescriptor;
    p?: number | AutoP;
    epsilon?: number | AutoEpsilon;
    phi?: number | AutoPhi;
  }
>(
  config: T,
  image: ChannelImage
): Promise<Omit<T, "thresholdStrategy" | "p" | "epsilon" | "phi"> & {
  thresholdStrategy?: ThresholdStrategy;
  p?: number | ChannelImage;
  epsilon?: number | ChannelImage;
  phi?: number | ChannelImage;
}> {
  const { thresholdStrategy, p, epsilon, phi, ...rest } = config;
  const resolvedP = await resolveP(p, image);
  const resolvedEpsilon = await resolveEpsilon(epsilon, image);
  const resolvedPhi = await resolvePhi(phi, image);
  return {
    ...rest,
    ...(thresholdStrategy ? { thresholdStrategy: createThresholdStrategy(thresholdStrategy) } : {}),
    ...(resolvedP !== undefined ? { p: resolvedP } : {}),
    ...(resolvedEpsilon !== undefined ? { epsilon: resolvedEpsilon } : {}),
    ...(resolvedPhi !== undefined ? { phi: resolvedPhi } : {}),
  };
}

/** Shared by ADoG leaves and HDoG's nested adog/adogSecondary configs. */
function hydrateADoGConfig(config: Partial<WireADoGConfig>, image: ChannelImage) {
  return hydrateAutoConfig(config, image);
}

async function createDoGImplementation(node: DogConfigNode, image: ChannelImage): Promise<DoGImplementation> {
  switch (node.type) {
    case "xdog": {
      const { blurStrategy, ...rest } = node.config;
      return new XDoG({
        ...await hydrateAutoConfig(rest, image),
        ...(blurStrategy ? { blurStrategy: await createBlurStrategy(blurStrategy) } : {}),
      });
    }
    case "fdog":
      return new FDoG(await hydrateAutoConfig(node.config, image));
    case "adog":
      return new ADoG(await hydrateAutoConfig(node.config, image));
    case "hdog": {
      const { fdog, adog, adogSecondary, ...rest } = node.config;
      return new HDoG({
        ...rest,
        ...(fdog ? { fdog: await hydrateAutoConfig(fdog, image) } : {}),
        ...(adog ? { adog: await hydrateADoGConfig(adog, image) } : {}),
        ...(adogSecondary ? { adogSecondary: await hydrateADoGConfig(adogSecondary, image) } : {}),
      });
    }
    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unsupported DoG component type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

async function buildExecutionLeaf(node: DogConfigNode, image: ChannelImage): Promise<DogExecutionLeaf> {
  return { kind: "dog", implementation: await createDoGImplementation(node, image) };
}

async function buildExecutionLayer(layer: DogLayer, image: ChannelImage): Promise<DogExecutionLayer> {
  const components = await Promise.all(layer.components.map((node) => buildExecutionNode(node, image)));
  return {
    kind: "layer",
    name: layer.name,
    components,
    blendMode: components.length > 1 ? multiScale.BlendFunctions[layer.blendMode] : undefined,
  };
}

async function buildExecutionNode(node: DogNode, image: ChannelImage): Promise<DogExecutionNode> {
  if (isConfig(node)) return await buildExecutionLeaf(node, image);
  if (isLayer(node)) return await buildExecutionLayer(node, image);
  const exhaustiveCheck: never = node;
  throw new Error(`Unsupported DogNode: ${JSON.stringify(exhaustiveCheck)}`);
}

/**
 * `image` is the same image the built tree is about to run against — every
 * leaf's auto p/epsilon/phi gets resolved against it here, before its
 * DoGImplementation is constructed. Since this is called fresh per
 * `executeDogProcessingContext` call (i.e. fresh per worker `run()` — see
 * dog-service.ts/dog.worker.ts, unchanged), a video export's per-frame
 * calls each resolve auto params against their own frame automatically.
 */
export async function buildExecutionTree(nodes: DogNode[], image: ChannelImage): Promise<DogExecutionNode[]> {
  return Promise.all(nodes.map((node) => buildExecutionNode(node, image)));
}

export async function buildExecutablePlan(context: DogProcessingContext, image: ChannelImage): Promise<DogExecutablePlan> {
  return { dog: await buildExecutionTree(context.dog, image) };
}

// =============================================================================
// 2. Execute: DogExecutionNode[] + ChannelImage -> ChannelImage
//    Entirely unchanged from before — implementations are already built by
//    the time this runs.
// =============================================================================

const equalWeightAverage: BlendFunction = (ctx) => {
  let sum = 0;
  for (let i = 0; i < ctx.values.length; i++) sum += ctx.values[i] * ctx.weights[i];
  return sum;
};

function blendChannelImages(images: ChannelImage[], blend: BlendFunction): ChannelImage {
  const { width, height } = images[0];
  const output = createChannelImage(width, height);
  const weight = 1 / images.length;
  const weights = new Array<number>(images.length).fill(weight);
  const values = new Array<number>(images.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let j = 0; j < images.length; j++) values[j] = images[j].data[i];
      output.data[i] = blend({ values, weights, x, y, width, height });
    }
  }
  return output;
}

export async function executeDogNode(node: DogExecutionNode, input: ChannelImage): Promise<ChannelImage> {
  if (isExecutionLayer(node)) return executeDogLayer(node, input);
  return node.implementation.process(input);
}

async function executeDogLayer(layer: DogExecutionLayer, input: ChannelImage): Promise<ChannelImage> {
  if (layer.components.length === 0) return input;
  const results = await Promise.all(layer.components.map((component) => executeDogNode(component, input)));
  if (results.length === 1) return results[0];
  return blendChannelImages(results, layer.blendMode ?? equalWeightAverage);
}

function executeDogPipeline(nodes: DogExecutionNode[], input: ChannelImage): Promise<ChannelImage> {
  return nodes.reduce<Promise<ChannelImage>>(
    (imagePromise, node) =>
      imagePromise.then(async (image) => {
        try {
          return await executeDogNode(node, image);
        } finally {
          disposeExecutionTree([node]);
        }
      }),
    Promise.resolve(input)
  );
}

export async function executeDogExecutablePlan(plan: DogExecutablePlan, input: ChannelImage): Promise<ChannelImage> {
  return executeDogPipeline(plan.dog, input);
}

/** Convenience one-shot: build + execute directly from a `DogProcessingContext`. */
export async function executeDogProcessingContext(
  context: DogProcessingContext,
  input: ChannelImage
): Promise<ChannelImage> {
  const executionPlan = await buildExecutablePlan(context, input);
  return executeDogExecutablePlan(executionPlan, input);
}

export function disposeExecutionTree(nodes: DogExecutionNode[]): void {
  for (const node of nodes) {
    if (isExecutionLayer(node)) {
      disposeExecutionTree(node.components);
    } else {
      node.implementation.dispose();
    }
  }
}

export function presetFromLibrary<T extends XDogPreset | ADogPreset | FDogPreset | HDogPresetConfig>(config: unknown): T {
  return config as T;
}