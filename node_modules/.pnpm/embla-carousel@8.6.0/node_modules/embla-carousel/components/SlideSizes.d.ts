import { AxisType } from './Axis';
import { NodeRectType } from './NodeRects';
import { WindowType } from './utils';
export type SlideSizesType = {
    slideSizes: number[];
    slideSizesWithGaps: number[];
    startGap: number;
    endGap: number;
};
export declare function SlideSizes(axis: AxisType, containerRect: NodeRectType, slideRects: NodeRectType[], slides: HTMLElement[], readEdgeGap: boolean, ownerWindow: WindowType): SlideSizesType;
