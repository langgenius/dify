import { Vector1DType } from './Vector1d.js';
export type ScrollBodyType = {
    direction: () => number;
    duration: () => number;
    velocity: () => number;
    seek: () => ScrollBodyType;
    settled: () => boolean;
    useBaseFriction: () => ScrollBodyType;
    useBaseDuration: () => ScrollBodyType;
    useFriction: (n: number) => ScrollBodyType;
    useDuration: (n: number) => ScrollBodyType;
};
export declare function ScrollBody(location: Vector1DType, offsetLocation: Vector1DType, previousLocation: Vector1DType, target: Vector1DType, baseDuration: number, baseFriction: number): ScrollBodyType;
