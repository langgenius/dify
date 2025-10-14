import { AlignmentType } from './Alignment';
import { AxisType } from './Axis';
import { NodeRectType } from './NodeRects';
import { SlidesToScrollType } from './SlidesToScroll';
export type ScrollSnapsType = {
    snaps: number[];
    snapsAligned: number[];
};
export declare function ScrollSnaps(axis: AxisType, alignment: AlignmentType, containerRect: NodeRectType, slideRects: NodeRectType[], slidesToScroll: SlidesToScrollType): ScrollSnapsType;
