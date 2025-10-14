import { EmblaCarouselType } from './EmblaCarousel';
import { OptionsHandlerType } from './OptionsHandler';
import { EmblaPluginsType, EmblaPluginType } from './Plugins';
export type PluginsHandlerType = {
    init: (emblaApi: EmblaCarouselType, plugins: EmblaPluginType[]) => EmblaPluginsType;
    destroy: () => void;
};
export declare function PluginsHandler(optionsHandler: OptionsHandlerType): PluginsHandlerType;
