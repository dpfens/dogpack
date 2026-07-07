"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webgl = exports.LocalVariancePreprocessorOptimized = exports.LocalVariancePreprocessor = void 0;
const tslib_1 = require("tslib");
var local_variance_js_1 = require("./local-variance.js");
Object.defineProperty(exports, "LocalVariancePreprocessor", { enumerable: true, get: function () { return local_variance_js_1.LocalVariancePreprocessor; } });
Object.defineProperty(exports, "LocalVariancePreprocessorOptimized", { enumerable: true, get: function () { return local_variance_js_1.LocalVariancePreprocessorOptimized; } });
tslib_1.__exportStar(require("./preprocess.js"), exports);
exports.webgl = require("./webgl.js");
//# sourceMappingURL=index.js.map