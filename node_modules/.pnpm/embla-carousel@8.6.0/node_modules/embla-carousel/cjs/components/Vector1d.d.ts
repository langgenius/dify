export type Vector1DType = {
    get: () => number;
    set: (n: Vector1DType | number) => void;
    add: (n: Vector1DType | number) => void;
    subtract: (n: Vector1DType | number) => void;
};
export declare function Vector1D(initialValue: number): Vector1DType;
