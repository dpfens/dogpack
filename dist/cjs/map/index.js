"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
tslib_1.__exportStar(require("./channel-map-ops.js"), exports);
tslib_1.__exportStar(require("./structure-tensor.js"), exports);
tslib_1.__exportStar(require("./strategies.js"), exports);
/**
 * Worked example: register strategies once, rebuild overrides per input,
 * swap any one of them without touching the rest.
 *
 * import { FDoG } from '../fdog.js';
 * import { BilateralFilter } from '../preprocess.js';
 * import {
 *   ParameterMapPipeline, TextureStrategy, structureTensorStrategies,
 *   LuminanceStrategy, DetailResidualStrategy, CompositeStrategy,
 * } from './maps/index.js';
 *
 * const { anisotropy } = structureTensorStrategies({
 *   epsilon: { epsilonLow: 0.35, epsilonHigh: 0.7, saturateAt: 4 },
 *   phi: { phiLow: 5, phiHigh: 80 },
 * });
 *
 * const epsilon = new CompositeStrategy('epsilon', [
 *   { strategy: new TextureStrategy('epsilon', { low: 0.5, high: 0.85 }) },
 *   { strategy: new LuminanceStrategy({ epsilonDark: 0.35, epsilonLight: 0.6 }) },
 * ]);
 *
 * const pipeline = new ParameterMapPipeline({
 *   p: new TextureStrategy('p', { low: 10, high: 40 }),
 *   epsilon,
 *   phi: anisotropy,
 * });
 *
 * const fdog = new FDoG();
 * const result = await fdog.process(input, await pipeline.build(input));
 *
 * // Swap epsilon for something else entirely -- nothing else changes:
 * const bilateral = await BilateralFilter.create({ sigmaSpatial: 4, sigmaRange: 0.1 });
 * pipeline.set('epsilon', new DetailResidualStrategy('epsilon', bilateral, { low: 0.5, high: 0.8 }));
 *
 * pipeline.dispose();
 */
//# sourceMappingURL=index.js.map