import { AxisType } from './Axis.js';
import { NodeRectType } from './NodeRects.js';
import { WindowType } from './utils.js';
export type SlideSizesType = {
    slideSizes: number[];
    slideSizesWithGaps: number[];
    startGap: number;
    endGap: number;
};
export declare function SlideSizes(axis: AxisType, containerRect: NodeRectType, slideRects: NodeRectType[], slides: HTMLElement[], readEdgeGap: boolean, ownerWindow: WindowType): SlideSizesType;
