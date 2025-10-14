import { AxisType } from './Axis.js';
import { EmblaCarouselType } from './EmblaCarousel.js';
import { EventHandlerType } from './EventHandler.js';
import { NodeRectsType } from './NodeRects.js';
import { WindowType } from './utils.js';
type ResizeHandlerCallbackType = (emblaApi: EmblaCarouselType, entries: ResizeObserverEntry[]) => boolean | void;
export type ResizeHandlerOptionType = boolean | ResizeHandlerCallbackType;
export type ResizeHandlerType = {
    init: (emblaApi: EmblaCarouselType) => void;
    destroy: () => void;
};
export declare function ResizeHandler(container: HTMLElement, eventHandler: EventHandlerType, ownerWindow: WindowType, slides: HTMLElement[], axis: AxisType, watchResize: ResizeHandlerOptionType, nodeRects: NodeRectsType): ResizeHandlerType;
export {};
