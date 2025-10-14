import { AxisType } from './Axis';
import { EmblaCarouselType } from './EmblaCarousel';
import { EventHandlerType } from './EventHandler';
import { NodeRectsType } from './NodeRects';
import { WindowType } from './utils';
type ResizeHandlerCallbackType = (emblaApi: EmblaCarouselType, entries: ResizeObserverEntry[]) => boolean | void;
export type ResizeHandlerOptionType = boolean | ResizeHandlerCallbackType;
export type ResizeHandlerType = {
    init: (emblaApi: EmblaCarouselType) => void;
    destroy: () => void;
};
export declare function ResizeHandler(container: HTMLElement, eventHandler: EventHandlerType, ownerWindow: WindowType, slides: HTMLElement[], axis: AxisType, watchResize: ResizeHandlerOptionType, nodeRects: NodeRectsType): ResizeHandlerType;
export {};
