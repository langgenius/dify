import { LimitType } from './Limit.js';
import { ScrollBodyType } from './ScrollBody.js';
import { Vector1DType } from './Vector1d.js';
import { PercentOfViewType } from './PercentOfView.js';
export type ScrollBoundsType = {
    shouldConstrain: () => boolean;
    constrain: (pointerDown: boolean) => void;
    toggleActive: (active: boolean) => void;
};
export declare function ScrollBounds(limit: LimitType, location: Vector1DType, target: Vector1DType, scrollBody: ScrollBodyType, percentOfView: PercentOfViewType): ScrollBoundsType;
