/**
 * Image utility functions
 */
/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
export function at(value, i) {
    return typeof value === "number" ? value : value.data[i];
}
export * from './device.js';
export * from './image.js';
export * from './math.js';
export * as color from './color.js';
//# sourceMappingURL=index.js.map