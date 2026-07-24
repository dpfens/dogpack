"use strict";
/**
 * Image utility functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.color = void 0;
exports.at = at;
const tslib_1 = require("tslib");
/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
function at(value, i) {
    return typeof value === "number" ? value : value.data[i];
}
tslib_1.__exportStar(require("./device.js"), exports);
tslib_1.__exportStar(require("./image.js"), exports);
tslib_1.__exportStar(require("./math.js"), exports);
exports.color = require("./color.js");
//# sourceMappingURL=index.js.map