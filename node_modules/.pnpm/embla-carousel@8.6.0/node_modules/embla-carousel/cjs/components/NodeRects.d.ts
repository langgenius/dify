export type NodeRectType = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
};
export type NodeRectsType = {
    measure: (node: HTMLElement) => NodeRectType;
};
export declare function NodeRects(): NodeRectsType;
