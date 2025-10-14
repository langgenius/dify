import { LimitType } from './Limit.js';
import { Vector1DType } from './Vector1d.js';
export type ScrollLooperType = {
    loop: (direction: number) => void;
};
export declare function ScrollLooper(contentSize: number, limit: LimitType, location: Vector1DType, vectors: Vector1DType[]): ScrollLooperType;
