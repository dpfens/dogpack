export type {DoGConfig, DoGImplementation, DogConfigParamType, XDoGConfig, XDogConfigParamType, FDoGConfig, FDogConfigParamType, FDogConfidenceWeightConfigParamType, FDoGConfidenceWeightingConfig, ADoGConfig, ADogConfigParamType, HDoGConfig, HDogConfigParamType, ADoGProcessingResult, HDoGProcessingResult, ParamRange} from '../interfaces/dog.js'
export {
    DEFAULT_DOG_CONFIG, DEFAULT_FDOG_CONFIG, DEFAULT_ADOG_CONFIG, DEFAULT_HDOG_CONFIG,
    DOG_PARAM_RANGES, XDOG_PARAM_RANGES, FDOG_PARAM_RANGES, FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES, ADOG_PARAM_RANGES, HDOG_PARAM_RANGES,
    STYLE_PRESETS, FDOG_STYLE_PRESETS, ADOG_STYLE_PRESETS, HDOG_STYLE_PRESETS
} from '../interfaces/dog.js'
export { XDoG, xdog } from './xdog.js'
export { FDoG, fdog} from './fdog.js'
export { ADoG, adog} from './adog.js'
export { HDoG, hdog } from './hdog.js'