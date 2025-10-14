import { LimitType } from './Limit';
import { Vector1DType } from './Vector1d';
export type ScrollLooperType = {
    loop: (direction: number) => void;
};
export declare function ScrollLooper(contentSize: number, limit: LimitType, location: Vector1DType, vectors: Vector1DType[]): ScrollLooperType;
