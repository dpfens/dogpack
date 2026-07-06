"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EdgeTangentFlow = void 0;
const webgl_1 = require("./webgl");
const cpu_1 = require("./cpu");
/**
 * Unified Edge Tangent Flow that automatically selects the best implementation
 */
class EdgeTangentFlow {
    impl;
    width;
    height;
    constructor(impl) {
        this.impl = impl;
        this.width = impl.width;
        this.height = impl.height;
    }
    getTangent(x, y) {
        return this.impl.getTangent(x, y);
    }
    getTangentArray() {
        return this.impl.getTangentArray();
    }
    visualize() {
        return this.impl.visualize();
    }
    /**
     * Check if WebGL acceleration is available
     */
    static isWebGLSupported() {
        return webgl_1.EdgeTangentFlowWebGL.isSupported();
    }
    /**
     * Compute ETF using the best available implementation
     *
     * @param input Grayscale image
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma
     * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'auto')
     */
    static compute(input, config = {}, sigmaC, forceImpl = 'auto') {
        let useWebGL = false;
        if (forceImpl === 'webgl') {
            if (!webgl_1.EdgeTangentFlowWebGL.isSupported()) {
                throw new Error('WebGL not supported but webgl implementation was forced');
            }
            useWebGL = true;
        }
        else if (forceImpl === 'auto') {
            useWebGL = webgl_1.EdgeTangentFlowWebGL.isSupported();
        }
        // forceImpl === 'cpu' leaves useWebGL as false
        if (useWebGL) {
            console.log('[ETF] Using WebGL implementation');
            const impl = webgl_1.EdgeTangentFlowWebGL.compute(input, config, sigmaC);
            return new EdgeTangentFlow(impl);
        }
        else {
            console.log('[ETF] Using CPU implementation');
            // Import dynamically to avoid circular deps if needed
            const impl = cpu_1.EdgeTangentFlow.compute(input, config, sigmaC);
            return new EdgeTangentFlow(impl);
        }
    }
    /**
     * Cleanup WebGL resources
     */
    static dispose() {
        webgl_1.EdgeTangentFlowWebGL.dispose();
    }
}
exports.EdgeTangentFlow = EdgeTangentFlow;
exports.default = EdgeTangentFlow;
//# sourceMappingURL=index.js.map