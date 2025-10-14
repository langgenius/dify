import { AxisType } from './Axis.js';
export type TranslateType = {
    clear: () => void;
    to: (target: number) => void;
    toggleActive: (active: boolean) => void;
};
export declare function Translate(axis: AxisType, container: HTMLElement): TranslateType;
