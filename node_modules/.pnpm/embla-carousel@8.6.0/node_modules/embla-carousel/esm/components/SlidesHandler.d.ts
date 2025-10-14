import { EmblaCarouselType } from './EmblaCarousel.js';
import { EventHandlerType } from './EventHandler.js';
type SlidesHandlerCallbackType = (emblaApi: EmblaCarouselType, mutations: MutationRecord[]) => boolean | void;
export type SlidesHandlerOptionType = boolean | SlidesHandlerCallbackType;
export type SlidesHandlerType = {
    init: (emblaApi: EmblaCarouselType) => void;
    destroy: () => void;
};
export declare function SlidesHandler(container: HTMLElement, eventHandler: EventHandlerType, watchSlides: SlidesHandlerOptionType): SlidesHandlerType;
export {};
