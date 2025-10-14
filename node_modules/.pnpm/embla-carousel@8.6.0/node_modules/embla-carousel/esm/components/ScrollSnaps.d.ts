import { AlignmentType } from './Alignment.js';
import { AxisType } from './Axis.js';
import { NodeRectType } from './NodeRects.js';
import { SlidesToScrollType } from './SlidesToScroll.js';
export type ScrollSnapsType = {
    snaps: number[];
    snapsAligned: number[];
};
export declare function ScrollSnaps(axis: AxisType, alignment: AlignmentType, containerRect: NodeRectType, slideRects: NodeRectType[], slidesToScroll: SlidesToScrollType): ScrollSnapsType;
