export type LimitType = {
    min: number;
    max: number;
    length: number;
    constrain: (n: number) => number;
    reachedAny: (n: number) => boolean;
    reachedMax: (n: number) => boolean;
    reachedMin: (n: number) => boolean;
    removeOffset: (n: number) => number;
};
export declare function Limit(min?: number, max?: number): LimitType;
