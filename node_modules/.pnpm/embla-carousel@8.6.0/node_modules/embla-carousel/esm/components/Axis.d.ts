import { NodeRectType } from './NodeRects.js';
export type AxisOptionType = 'x' | 'y';
export type AxisDirectionOptionType = 'ltr' | 'rtl';
type AxisEdgeType = 'top' | 'right' | 'bottom' | 'left';
export type AxisType = {
    scroll: AxisOptionType;
    cross: AxisOptionType;
    startEdge: AxisEdgeType;
    endEdge: AxisEdgeType;
    measureSize: (nodeRect: NodeRectType) => number;
    direction: (n: number) => number;
};
export declare function Axis(axis: AxisOptionType, contentDirection: AxisDirectionOptionType): AxisType;
export {};
