'use strict';

var react = require('react');
var emblaCarouselReactiveUtils = require('embla-carousel-reactive-utils');
var EmblaCarousel = require('embla-carousel');

function useEmblaCarousel(options = {}, plugins = []) {
  const storedOptions = react.useRef(options);
  const storedPlugins = react.useRef(plugins);
  const [emblaApi, setEmblaApi] = react.useState();
  const [viewport, setViewport] = react.useState();
  const reInit = react.useCallback(() => {
    if (emblaApi) emblaApi.reInit(storedOptions.current, storedPlugins.current);
  }, [emblaApi]);
  react.useEffect(() => {
    if (emblaCarouselReactiveUtils.areOptionsEqual(storedOptions.current, options)) return;
    storedOptions.current = options;
    reInit();
  }, [options, reInit]);
  react.useEffect(() => {
    if (emblaCarouselReactiveUtils.arePluginsEqual(storedPlugins.current, plugins)) return;
    storedPlugins.current = plugins;
    reInit();
  }, [plugins, reInit]);
  react.useEffect(() => {
    if (emblaCarouselReactiveUtils.canUseDOM() && viewport) {
      EmblaCarousel.globalOptions = useEmblaCarousel.globalOptions;
      const newEmblaApi = EmblaCarousel(viewport, storedOptions.current, storedPlugins.current);
      setEmblaApi(newEmblaApi);
      return () => newEmblaApi.destroy();
    } else {
      setEmblaApi(undefined);
    }
  }, [viewport, setEmblaApi]);
  return [setViewport, emblaApi];
}
useEmblaCarousel.globalOptions = undefined;

module.exports = useEmblaCarousel;
//# sourceMappingURL=embla-carousel-react.cjs.js.map
