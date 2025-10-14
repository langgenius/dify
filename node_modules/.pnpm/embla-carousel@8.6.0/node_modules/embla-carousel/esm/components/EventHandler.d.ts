import { EmblaCarouselType } from './EmblaCarousel.js';
type CallbackType = (emblaApi: EmblaCarouselType, evt: EmblaEventType) => void;
export type EmblaEventType = EmblaEventListType[keyof EmblaEventListType];
export interface EmblaEventListType {
    init: 'init';
    pointerDown: 'pointerDown';
    pointerUp: 'pointerUp';
    slidesChanged: 'slidesChanged';
    slidesInView: 'slidesInView';
    scroll: 'scroll';
    select: 'select';
    settle: 'settle';
    destroy: 'destroy';
    reInit: 'reInit';
    resize: 'resize';
    slideFocusStart: 'slideFocusStart';
    slideFocus: 'slideFocus';
}
export type EventHandlerType = {
    init: (emblaApi: EmblaCarouselType) => void;
    emit: (evt: EmblaEventType) => EventHandlerType;
    on: (evt: EmblaEventType, cb: CallbackType) => EventHandlerType;
    off: (evt: EmblaEventType, cb: CallbackType) => EventHandlerType;
    clear: () => void;
};
export declare function EventHandler(): EventHandlerType;
export {};
