/**
 * Raw structure tensor: magnitude (edge confidence) and anisotropy
 * (directional coherence). Kept separate from strategies.ts because it's
 * the one feature with no existing preprocessor to delegate to --
 * ETFComputer only exposes the flow field + trace magnitude
 * (ETFDetailedResult), not the raw e/f/g components anisotropy needs.
 */
import type { ChannelImage } from '../interfaces/base.js';
export interface StructureTensorMaps {
    magnitude: ChannelImage;
    /** (lambda1-lambda2)/(lambda1+lambda2) in [0,1]. 1 = coherent line, 0 = isotropic. */
    anisotropy: ChannelImage;
}
export declare function computeStructureTensorMaps(input: ChannelImage, smoothingRadius?: number): StructureTensorMaps;
//# sourceMappingURL=structure-tensor.d.ts.map