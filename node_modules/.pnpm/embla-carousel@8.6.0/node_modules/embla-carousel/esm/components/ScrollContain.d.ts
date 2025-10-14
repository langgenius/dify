import { LimitType } from './Limit.js';
export type ScrollContainOptionType = false | 'trimSnaps' | 'keepSnaps';
export type ScrollContainType = {
    snapsContained: number[];
    scrollContainLimit: LimitType;
};
export declare function ScrollContain(viewSize: number, contentSize: number, snapsAligned: number[], containScroll: ScrollContainOptionType, pixelTolerance: number): ScrollContainType;
