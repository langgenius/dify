import { EmblaCarouselType } from './EmblaCarousel.js';
import { OptionsHandlerType } from './OptionsHandler.js';
import { EmblaPluginsType, EmblaPluginType } from './Plugins.js';
export type PluginsHandlerType = {
    init: (emblaApi: EmblaCarouselType, plugins: EmblaPluginType[]) => EmblaPluginsType;
    destroy: () => void;
};
export declare function PluginsHandler(optionsHandler: OptionsHandlerType): PluginsHandlerType;
