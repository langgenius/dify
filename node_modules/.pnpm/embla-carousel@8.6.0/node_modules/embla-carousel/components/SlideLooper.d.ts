import { AxisType } from './Axis';
import { Vector1DType } from './Vector1d';
import { TranslateType } from './Translate';
type LoopPointType = {
    loopPoint: number;
    index: number;
    translate: TranslateType;
    slideLocation: Vector1DType;
    target: () => number;
};
export type SlideLooperType = {
    canLoop: () => boolean;
    clear: () => void;
    loop: () => void;
    loopPoints: LoopPointType[];
};
export declare function SlideLooper(axis: AxisType, viewSize: number, contentSize: number, slideSizes: number[], slideSizesWithGaps: number[], snaps: number[], scrollSnaps: number[], location: Vector1DType, slides: HTMLElement[]): SlideLooperType;
export {};
