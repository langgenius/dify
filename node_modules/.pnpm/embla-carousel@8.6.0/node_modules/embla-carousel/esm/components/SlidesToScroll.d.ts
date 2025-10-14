import { AxisType } from './Axis.js';
import { NodeRectType } from './NodeRects.js';
export type SlidesToScrollOptionType = 'auto' | number;
export type SlidesToScrollType = {
    groupSlides: <Type>(array: Type[]) => Type[][];
};
export declare function SlidesToScroll(axis: AxisType, viewSize: number, slidesToScroll: SlidesToScrollOptionType, loop: boolean, containerRect: NodeRectType, slideRects: NodeRectType[], startGap: number, endGap: number, pixelTolerance: number): SlidesToScrollType;
