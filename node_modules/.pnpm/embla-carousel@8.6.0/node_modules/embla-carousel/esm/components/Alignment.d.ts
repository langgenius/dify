export type AlignmentOptionType = 'start' | 'center' | 'end' | ((viewSize: number, snapSize: number, index: number) => number);
export type AlignmentType = {
    measure: (n: number, index: number) => number;
};
export declare function Alignment(align: AlignmentOptionType, viewSize: number): AlignmentType;
