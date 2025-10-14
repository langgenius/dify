import { EmblaCarouselType } from './EmblaCarousel';
import { EventHandlerType } from './EventHandler';
import { EventStoreType } from './EventStore';
import { ScrollBodyType } from './ScrollBody';
import { ScrollToType } from './ScrollTo';
import { SlideRegistryType } from './SlideRegistry';
type FocusHandlerCallbackType = (emblaApi: EmblaCarouselType, evt: FocusEvent) => boolean | void;
export type FocusHandlerOptionType = boolean | FocusHandlerCallbackType;
export type SlideFocusType = {
    init: (emblaApi: EmblaCarouselType) => void;
};
export declare function SlideFocus(root: HTMLElement, slides: HTMLElement[], slideRegistry: SlideRegistryType['slideRegistry'], scrollTo: ScrollToType, scrollBody: ScrollBodyType, eventStore: EventStoreType, eventHandler: EventHandlerType, watchFocus: FocusHandlerOptionType): SlideFocusType;
export {};
