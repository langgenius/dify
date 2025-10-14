import { LimitType } from './Limit';
import { Vector1DType } from './Vector1d';
export type TargetType = {
    distance: number;
    index: number;
};
export type ScrollTargetType = {
    byIndex: (target: number, direction: number) => TargetType;
    byDistance: (force: number, snap: boolean) => TargetType;
    shortcut: (target: number, direction: number) => number;
};
export declare function ScrollTarget(loop: boolean, scrollSnaps: number[], contentSize: number, limit: LimitType, targetVector: Vector1DType): ScrollTargetType;
