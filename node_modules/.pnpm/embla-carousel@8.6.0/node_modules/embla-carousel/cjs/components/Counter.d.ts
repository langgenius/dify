export type CounterType = {
    get: () => number;
    set: (n: number) => CounterType;
    add: (n: number) => CounterType;
    clone: () => CounterType;
};
export declare function Counter(max: number, start: number, loop: boolean): CounterType;
