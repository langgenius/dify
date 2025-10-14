import { EngineType } from './Engine.js';
import { EventHandlerType } from './EventHandler.js';
import { EmblaOptionsType } from './Options.js';
import { EmblaPluginsType, EmblaPluginType } from './Plugins.js';
export type EmblaCarouselType = {
    canScrollNext: () => boolean;
    canScrollPrev: () => boolean;
    containerNode: () => HTMLElement;
    internalEngine: () => EngineType;
    destroy: () => void;
    off: EventHandlerType['off'];
    on: EventHandlerType['on'];
    emit: EventHandlerType['emit'];
    plugins: () => EmblaPluginsType;
    previousScrollSnap: () => number;
    reInit: (options?: EmblaOptionsType, plugins?: EmblaPluginType[]) => void;
    rootNode: () => HTMLElement;
    scrollNext: (jump?: boolean) => void;
    scrollPrev: (jump?: boolean) => void;
    scrollProgress: () => number;
    scrollSnapList: () => number[];
    scrollTo: (index: number, jump?: boolean) => void;
    selectedScrollSnap: () => number;
    slideNodes: () => HTMLElement[];
    slidesInView: () => number[];
    slidesNotInView: () => number[];
};
declare function EmblaCarousel(root: HTMLElement, userOptions?: EmblaOptionsType, userPlugins?: EmblaPluginType[]): EmblaCarouselType;
declare namespace EmblaCarousel {
    let globalOptions: EmblaOptionsType | undefined;
}
export default EmblaCarousel;
