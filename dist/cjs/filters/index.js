"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webgpu = exports.webgl = exports.LocalVarianceFilter = void 0;
const tslib_1 = require("tslib");
var cpu_js_1 = require("./cpu.js");
Object.defineProperty(exports, "LocalVarianceFilter", { enumerable: true, get: function () { return cpu_js_1.LocalVarianceFilter; } });
tslib_1.__exportStar(require("./filters.js"), exports);
exports.webgl = require("./webgl.js");
exports.webgpu = require("./webgpu.js");
//# sourceMappingURL=index.js.map