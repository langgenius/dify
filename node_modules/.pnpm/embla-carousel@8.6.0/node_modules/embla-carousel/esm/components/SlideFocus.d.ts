import { EmblaCarouselType } from './EmblaCarousel.js';
import { EventHandlerType } from './EventHandler.js';
import { EventStoreType } from './EventStore.js';
import { ScrollBodyType } from './ScrollBody.js';
import { ScrollToType } from './ScrollTo.js';
import { SlideRegistryType } from './SlideRegistry.js';
type FocusHandlerCallbackType = (emblaApi: EmblaCarouselType, evt: FocusEvent) => boolean | void;
export type FocusHandlerOptionType = boolean | FocusHandlerCallbackType;
export type SlideFocusType = {
    init: (emblaApi: EmblaCarouselType) => void;
};
export declare function SlideFocus(root: HTMLElement, slides: HTMLElement[], slideRegistry: SlideRegistryType['slideRegistry'], scrollTo: ScrollToType, scrollBody: ScrollBodyType, eventStore: EventStoreType, eventHandler: EventHandlerType, watchFocus: FocusHandlerOptionType): SlideFocusType;
export {};
