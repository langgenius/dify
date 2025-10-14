import { EventHandlerType } from './EventHandler';
export type SlidesInViewOptionsType = IntersectionObserverInit['threshold'];
export type SlidesInViewType = {
    init: () => void;
    destroy: () => void;
    get: (inView?: boolean) => number[];
};
export declare function SlidesInView(container: HTMLElement, slides: HTMLElement[], eventHandler: EventHandlerType, threshold: SlidesInViewOptionsType): SlidesInViewType;
