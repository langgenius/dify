import { LimitType } from './Limit.js';
export type ScrollProgressType = {
    get: (n: number) => number;
};
export declare function ScrollProgress(limit: LimitType): ScrollProgressType;
