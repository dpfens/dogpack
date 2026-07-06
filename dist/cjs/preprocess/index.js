"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webgl = exports.LocalVariancePreprocessorOptimized = exports.LocalVariancePreprocessor = void 0;
const tslib_1 = require("tslib");
var local_variance_1 = require("./local-variance");
Object.defineProperty(exports, "LocalVariancePreprocessor", { enumerable: true, get: function () { return local_variance_1.LocalVariancePreprocessor; } });
Object.defineProperty(exports, "LocalVariancePreprocessorOptimized", { enumerable: true, get: function () { return local_variance_1.LocalVariancePreprocessorOptimized; } });
tslib_1.__exportStar(require("./preprocess"), exports);
exports.webgl = require("./webgl");
//# sourceMappingURL=index.js.map