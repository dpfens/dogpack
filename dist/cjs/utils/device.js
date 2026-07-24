"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWebGLComputeSupported = isWebGLComputeSupported;
exports.isWebGPUSupported = isWebGPUSupported;
let webglComputeSupportCache = null;
function isWebGLComputeSupported() {
    if (webglComputeSupportCache !== null)
        return webglComputeSupportCache;
    try {
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(1, 1)
            : typeof document !== 'undefined'
                ? document.createElement('canvas')
                : null;
        if (!canvas) {
            webglComputeSupportCache = false;
            return webglComputeSupportCache;
        }
        const gl = canvas.getContext('webgl2');
        if (!gl) {
            webglComputeSupportCache = false;
            return webglComputeSupportCache;
        }
        // Exclude software rasterizers — too slow to be a useful compute fallback
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : '';
        const isSoftware = /swiftshader|software|llvmpipe/i.test(renderer);
        // Required for float render targets, used in most GPGPU-style passes
        const hasFloatTargets = gl.getExtension('EXT_color_buffer_float') !== null;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        webglComputeSupportCache = !isSoftware && hasFloatTargets;
        return webglComputeSupportCache;
    }
    catch {
        webglComputeSupportCache = false;
        return webglComputeSupportCache;
    }
}
async function isWebGPUSupported() {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=device.js.map